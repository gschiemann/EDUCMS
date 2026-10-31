# The Foundry Standard

## Universal Application Standard for an AI-Native Software Company

**Version** 1.0.0 · **Status** Governing · **Applies to** every software product we create, now and in the future · **Owner** Greg Schiemann · **Amended only by pull request** (see `AMENDMENTS.md`) — never silently.

---

## Preamble

We are not building applications. We are building a company that builds applications better every day, with AI doing the work and a human owning direction, judgement and risk. Each product is one output of that company. The deeper product is the **foundry**: the loop that researches, designs, builds, secures, tests, attacks, validates, deploys, observes, supports, diagnoses, repairs, communicates, learns and improves — and that inherits everything every earlier product taught it.

Three rules make this document different from a statement of values:

1. **Every article names its mechanism.** A principle is enforced by a gate, a register, a template, a script or a test — or the application's `MECHANISMS.md` lists it as a GAP. A principle with no mechanism is a wish, and we do not pretend otherwise.
2. **Every article names its evidence.** Compliance is something you can show, not something you assert.
3. **This document is itself a product.** It is versioned, it is challenged by every new model, and it may be improved by anyone — but never silently (Article 45).

The one thing that never changes: **build the best product we can today while building a system capable of building a better one tomorrow.**

**Two classes of article.** Articles 1, 2, 4, 40, 46, 48, 50 and 52 are **charter** articles: they state purpose and direction, and no mechanism is expected of them beyond the reviews that cite them. Every other article is **normative**: it is enforced by a mechanism or honestly listed as a GAP, and the application's GAP count is the headline of its `MECHANISMS.md` — a number that is only allowed to go down.

---

# PART I — MISSION AND AMBITION

### Article 1 — Mission

Every application is built twice: the product the customer uses, and the operating layer around it that can continuously **research → design → build → secure → test → attack → validate → deploy → observe → support → diagnose → repair → communicate → learn → improve**. Every product inherits the infrastructure, safeguards, tests, security standards and operating intelligence of every product before it. Do not think only about today's feature; strengthen the factory that builds features.

**Mechanism.** The kit (Article 51) and this standard, pinned by version in every application's North Star. **Evidence.** The application's `MECHANISMS.md` exists and is current.

### Article 2 — World-class ambition: the standard is #1

We are not building an acceptable product, a competitive product, or a copy of the leader. The objective is the best software product in the world in every market we enter, pursued as six simultaneous forms of leadership:

- **Most useful.** The end user comes first. Solve the actual problem better, faster, with less friction. Optimise usefulness, not feature count: a smaller capability that completely solves a problem beats ten features nobody needs. Ask what the software could do automatically, anticipate before they ask, remove clicks, remove training, remove the need for another tool.
- **Most profitable.** Extraordinary value + intelligent pricing + automation + operational efficiency + retention + scalable architecture. Never deceptive design, artificial lock-in, degraded security or a worse experience for short-term revenue. The best business is one customers willingly keep paying for because the value is obvious.
- **Most cutting-edge.** Operate at the technological frontier — AI, agents, models, vision, voice, data, infrastructure, security, interfaces, devices, tooling. When technology makes something newly possible, know quickly; research → prototype → test → compare → challenge → deploy when evidence supports it. Never adopt because it is new; never let inertia block a real advantage.
- **Most creative.** Competitors show what exists, not what is possible. Challenge every workflow: why does this step exist, why does a human do it, why seven screens, why does the report describe instead of recommend, why does the software wait instead of help. Invent the better interaction. **Creativity produces proposals** (Article 33, levels 0–1); it never ships an unrequested change.
- **Most flexible.** Adapt to different customers, industries, workflows, devices, integrations, AI providers and scales. Modular, configurable, extensible, API-driven, model-agnostic where appropriate. Complexity belongs inside the system, never on the user's shoulders.
- **Safest and most trustworthy.** Leadership is meaningless if customers cannot trust us. Innovation never overrides security, privacy, reliability, data integrity, honest communication, customer control or auditability. Our goal is not "move fast and break things"; it is to move extraordinarily fast *because* our validation, monitoring, security and rollback are better than everyone else's.

**The competitor is the baseline, not the ceiling.** Ask: if the world's best engineers, designers, security specialists, strategists and frontier models started this product from zero today with no legacy assumptions, what would they build? Build something better than that. For important workflows ask what would make it **ten times** better, not ten percent: eliminate the workflow, automate it, predict the need, turn analysis into action, generate instead of request, fix instead of alert.

**Customer value is the ultimate test.** Technology, AI, automation and features are not the product; the customer's outcome is. Every significant feature must answer: who does this help, what problem does it eliminate, how much better is the outcome, can we measure it, would customers notice if it disappeared.

**The ambition must also improve.** As capability grows, ask whether we are aiming high enough, whether our definition of "best" is outdated, what became possible in the last six months, whether a better business model or architecture now exists, whether ten agents can now be one, whether an approval can now be autonomous, whether days can now be minutes. The ceiling moves with technology; our ambition moves with it. Being the best today creates an obligation to build something better tomorrow.

**Mechanism.** The World-Class Scorecard (usefulness, product quality, reliability, security, innovation, creativity, flexibility, speed, profitability, loyalty, competitive advantage, adaptability) reviewed at every Frontier Intake (Article 41) and every weekly review (Article 44); the competitive scan in every full audit. **Evidence.** Scorecard entries dated and sourced; proposals that came from them.

### Article 3 — Priority order

When goals collide, this order decides, top first: **life safety → security and privacy → reliability → customer usefulness → speed → profitability → novelty.** It is a tiebreak, not a veto: profitability is pursued hard, but never by trading down anything above it. An application whose profile (Article 6) declares no life-safety function simply starts at security. **Life safety means alerts that are available AND authentic**: a forged, replayed or unauthenticated alert is itself a life-safety event, so "bring the screens back" never justifies accepting a credential or key that is known to be compromised. When an agent is unsure which priority applies, it treats the action as consequential (Article 33).

**Mechanism.** Written into every application's North Star; every decision record (Article 31) states which priority it served when two collided. **Evidence.** Decision records.

### Article 4 — Improve on every event

The company gets smarter whenever a customer reports a problem, an error occurs, a device fails, a test or deployment fails, a vulnerability is found, a customer asks for something, usage changes, a competitor improves, a technology or model appears, a human corrects an AI, an automated process does unusually well or badly, new security intelligence arrives, or an assumption proves wrong. Nothing important happens without the possibility of making the organisation smarter afterwards.

**Mechanism.** The incident protocol (Article 47), the feedback-to-policy rule (Article 32), the success protocol (Article 48) and the weekly review (Article 44) each end in a recorded change or a recorded "no change, because". **Evidence.** Every incident, correction and intake links to the test, rule, monitor or memory it produced.

### Article 5 — Non-negotiable truths

Never: fabricate evidence; hide uncertainty; ship because models agree; give one agent uncontrolled authority; make security an afterthought; let automation outrun evidence; lose a human correction; treat production as the test environment; ignore rollback; ignore observability; let institutional knowledge disappear when models change; preserve a method because it is established; quietly expand AI authority; confuse speed with recklessness.

**Mechanism.** Each truth maps to an article below with its own mechanism; a violation is an incident (Article 47). **Evidence.** Incident records.

---

# PART II — EVERY APPLICATION

### Article 6 — Application profile

Application-specific requirements are layered *below* this standard. Every application maintains a profile: name, primary mission, primary users, business model, critical workflows, sensitive information handled, external integrations, availability requirements, regulatory requirements, mission-critical functions, and the list of **approved exceptions** to this standard with who approved them and why. Everything not excepted is governed by this document.

**Mechanism.** `docs/governance/APP-PROFILE.md` from the kit template; exceptions require the Owner. **Evidence.** The profile, dated; its exception list.

### Article 7 — Build two things at once

Build the product and, alongside it, the reusable operating layer: development, review, testing, security, observability, support, incident management, customer communication, R&D, analytics, documentation, release management, model evaluation and process improvement. Never embed these so deeply in one application's architecture that they cannot be reused by the next.

**Mechanism.** Anything reusable is exported to the kit or named in `MECHANISMS.md` as "portable: yes/no". **Evidence.** The kit's changelog cites the application that contributed each piece.

### Article 8 — Day-zero product definition

Before substantial implementation, maintain a machine-readable product definition: mission, personas, problems, workflows, functional and non-functional requirements, business rules, data model, integrations, permissions, security and tenant boundaries, regulatory considerations, reliability and performance objectives, platforms, accessibility, disaster recovery, logging, audit, analytics, deployment architecture, update strategy, support model. Label unknowns as unknown. **Never silently invent a requirement.**

**Mechanism.** The profile (Article 6) plus the schema, API contracts and typed packages that are the definition's executable form. **Evidence.** A reviewer can trace any feature to a requirement or to a recorded unknown.

### Article 9 — Architect for change

Assume requirements, models, infrastructure, vendors, frameworks, threats and scale will change, and that customers will find workflows we never imagined. Prefer modular boundaries, defined interfaces, replaceable components, configuration over hard-coded assumptions, testable and observable services, versioned contracts, reversible (additive) migrations, portable data, and vendor abstraction where it is strategically useful. Use the simplest architecture that safely supports current requirements and foreseeable growth; never add complexity because it looks sophisticated.

**Mechanism.** Additive-only, idempotent migrations gated in CI; configuration through environment with documented defaults; vendor routes as data. **Evidence.** A schema change without a migration fails CI; a vendor can be swapped by configuration.

### Article 10 — Startup procedure

A new application never begins with code. It begins with Understand → Define → Architect → Threat-model → Test strategy → Observability → Development → Independent review → Validation (try to break it) → Staging → Human gate → Controlled production → Learn → Improve, then continues indefinitely. The first response to this standard in a new project is the thirteen-item First Response (`kit/templates/FIRST-RESPONSE.md`): mission, unknowns, architecture, security model, data model, critical workflows, testing, observability, autonomous-operations strategy, human approval map, roadmap, definition of done, reusable components. Do not wait for perfection before making progress; do not mistake activity for progress.

**Mechanism.** `kit/bootstrap.sh` installs the First Response checklist and the governance templates on day zero. **Evidence.** The completed First Response in the application's `docs/governance/`.

---

# PART III — SECURITY

### Article 11 — Security is foundational

Security participates in design, development, testing, deployment, production, support and incident response; it is never a final checklist. Every application begins with a threat model covering authentication, authorisation, account recovery, administrative privilege, tenant isolation, input validation, APIs, secrets, encryption, sessions, storage, transmission, uploads, third-party integrations, network exposure, supply chain, dependencies, build and CI/CD, cloud infrastructure, logging, backup, recovery, abuse cases and AI-specific attack surfaces. Default to least privilege. **The agents are part of the threat model:** a session that ingests untrusted text (customer-submitted content, bug reports, web pages, logs) holds no production write, deploy or secret-bearing tool; agent credentials are per-vendor, scoped and short-lived; no agent configuration file holds a production secret; and the agent's own permission set is derived from the autonomy register, never hand-widened.

**Mechanism.** A living threat model in `docs/governance/`; security gates in CI (secret scanning, tenant-isolation checks, dependency audit); boot-time refusal when a required secret is missing. **Evidence.** The threat model's last-reviewed date; green security gates on every merge.

### Article 12 — Independent security function

Security review is independent of implementation. The reviewer may challenge developers, architects, product, deployment and other models, and keeps asking: how could this be abused, what could an attacker reach, what happens if credentials are stolen or a customer turns malicious, can one tenant reach another, what attack surface is unnecessary, what changed since the last review. A security concern is never dismissed because the feature works.

**Mechanism.** Consequential changes (Article 33) are reviewed by a model from a **different vendor** than the one that wrote them (Article 17); a full security audit at every Frontier Intake. **Evidence.** The review's decision record names reviewer, model and vendor.

### Article 13 — Continuous threat intelligence

Stay aware of relevant CVEs, vendor and cloud advisories, dependency, framework, runtime, infrastructure and browser vulnerabilities, supply-chain attacks, authentication weaknesses and emerging techniques. For each relevant item: detect relevance → establish exposure → assess severity → contain → patch → test → release → verify → learn permanently. The objective is to minimise the time between public knowledge and customer protection.

**Mechanism.** A scheduled security watch plus the dependency audit, producing issues with a severity and a deadline. **Evidence.** Time-to-remediate per advisory (Article 49).

### Article 14 — Software inventory

Maintain a machine-readable bill of materials: what we run, where, which version, which products use it, which dependencies depend on it. When a vulnerability is announced we answer "are we affected?" in minutes.

**Mechanism.** The lockfile is the inventory of record; an exported SBOM where the platform supports it. **Evidence.** The answer to "are we affected?" for the last three advisories, with timestamps.

### Article 15 — Kill switches and decided failure directions

Every autonomous behaviour ships with a **subtractive** kill switch: unset means today's behaviour, and the switch can only ever remove a behaviour, never pin, strand or lock anyone out. When a safeguard cannot run (a dependency is down, a check times out), its failure direction — open or closed — is decided in advance, written down beside the safeguard, and tested. Security gates fail closed; availability of already-good work fails open. Never invert a written direction in a hotfix.

**Mechanism.** The autonomy register (Article 33) records the switch and the failure direction for every row; a test exercises the "cannot run" path. **Evidence.** The register; the test.

---

# PART IV — EVIDENCE

### Article 16 — Separation of authority

No single agent writes, approves, deploys, verifies and conceals its own change. Authority boundaries are **enforced by tools, never by an agent's promise.** Five roles: the **Builder** implements (any model, in an isolated worktree, never pushing to the main branch); the **Reviewer** critiques (a different vendor for consequential changes); the **Gate** is mechanical (CI, branch protection, guard scripts — it does not negotiate); the **Lead** is one designated session that merges after reading the diff and the evidence; the **Owner** approves consequential changes and raises autonomy levels. Other named functions (research, product, architecture, observability, support, governance) are hats worn inside these roles, not additional authorities.

**Mechanism.** Branch protection with required checks; worktree isolation; destructive-operation guards; the Lead-merges rule in the application's entry files; pipeline definitions treated as code under the same rules, with production-scoped secrets behind a protected environment that requires a reviewer. **Evidence.** No commit reaches the main branch outside a reviewed, gated merge; no production secret is reachable from an unreviewed branch.

### Article 17 — Multi-model development

No one model is best at everything, and no vendor is owed loyalty. For consequential changes use independent analysis — implementation by one model, architecture and adversarial and security review by others — where economically justified. Models are encouraged to disagree; we seek truth, not consensus.

**Mechanism.** The cross-vendor review rule for the consequential list; the routing table (Article 42). **Evidence.** The decision record names each model and vendor that took part.

### Article 18 — Consensus is not evidence

Never ship because several models agree. Models generate hypotheses; tests generate evidence. Use the appropriate combination of compilation, type checking, static analysis, unit, integration, API, contract, database, migration, UI, end-to-end, accessibility, authentication, authorisation, tenant-isolation, security, dependency, secrets, performance, load, stress, soak, failure-injection, recovery, upgrade, rollback, browser and device testing. **Testing depth reflects risk.**

**Mechanism.** CI gates whose required set grows with each incident; a CI job that dies before its tests run is red, never green. **Evidence.** The gate list in `MECHANISMS.md`, each entry citing the incident that created it **and its last observed red on a known-bad input** — a gate that has never been seen to fail is a hypothesis, so gates are replayed against the commits that created them.

### Article 19 — Glass is the truth

A green CI run is a unit-test claim, never a claim about the real target. Where the product runs on hardware, devices, browsers or environments CI cannot reproduce, qualification on the real target is a release gate, and "untested" is recorded as untested — never invented as a pass. Simulation (Article 20) narrows the gap; it never closes it.

**Mechanism.** A hardware/real-target qualification matrix checked by a script before any release build; an override is a logged debt with a name on it. **Evidence.** The matrix; the override log.

### Article 20 — Simulation and the digital twin

Where practical, maintain simulation infrastructure that represents production conditions: normal and power users, bad and malicious input, concurrency, slow and lost networks, API, database and dependency failures, clock problems, partial transactions, resource exhaustion, corrupted files, invalid configuration, version mismatches, unexpected restarts. Major releases meet adversity before customers do.

**Mechanism.** The end-to-end harness and fault-injection cases in the test suite; a simulation case is one of the products of every incident (Article 27). **Evidence.** The case list grows with the incident log.

### Article 21 — Verification before claim

Before any agent says a change is done, shipped or fixed, it has done one of: loaded the rendered result and looked at it; driven the live deployment; fetched the deployed artifact and found the change; or confirmed the commit is on the main branch *and* CI is green *and* the deployment is newer than the push. Otherwise it says **"unverified"**. "Pushed, awaiting verification" is honest; "done" before green is not.

**Mechanism.** The rule is in every entry file; the post-deploy smoke gate; the decision format's Validation line. **Evidence.** The proof (screenshot, URL, run id) attached to the claim.

---

# PART V — OPERATE

### Article 22 — Observability is a product feature

From day one the application can show its availability, latency, error rate, user and API failures, database, queue and infrastructure health, important business transactions, security signals and deployment impact — through structured logs, metrics, traces, correlation ids, health checks and audit events. Never log sensitive information unnecessarily.

**Mechanism.** Liveness, readiness and critical-path health endpoints; immutable audit log; request log; a capacity sampler. **Evidence.** The dashboards and the alert history.

### Article 23 — The software reports its own problems

Do not depend on customers to discover failures. The application detects meaningful anomalies and raises incidents into the same system as customer tickets.

**Mechanism.** Platform alerts to the Owner; customer-facing alerts that start in shadow mode (Article 33) and graduate on evidence; CI failures that open issues automatically. **Evidence.** The ratio of machine-detected to customer-reported incidents, trending up.

### Article 24 — Universal incident pipeline

Every meaningful incident follows: detect → correlate → classify → determine impact → gather evidence → reproduce → diagnose → mitigate → correct → test → secure → release → verify → communicate → learn. Correlate duplicates: one defect may produce hundreds of symptoms. Treat root causes, not tickets.

**Mechanism.** The incident template (`kit/templates/INCIDENT.md`) with both investigations (Article 47); incident state tables with dedupe keys. **Evidence.** Each incident record links its root cause and its permanent products (Article 27).

### Article 25 — Support is part of engineering

Every customer issue answers two questions: *how do we help this customer now* and *should the product change so no other customer experiences this*. Support is one of the company's primary sources of R&D intelligence.

**Mechanism.** The in-product bug reporter captures real session context; every resolved issue records the answer to question two. **Evidence.** Product changes that cite a support issue.

### Article 26 — Customer communication

Automate routine status where evidence permits: received, investigating, workaround available, reproduced, root cause confirmed, fix developed, testing, validated, scheduled, deployed, verified in production. **Never fabricate status, never invent release dates, never pretend uncertainty does not exist.** A system that cannot deliver a message says so instead of claiming it did.

**Mechanism.** Status transitions driven by recorded evidence, not by hand; send paths that fail loudly when unconfigured. **Evidence.** Every status message traces to the event that justified it.

### Article 27 — Every bug creates permanent value

A confirmed bug produces some combination of: a regression test, a monitoring rule, a better log, a new alert, a knowledge-base entry, an architecture rule, a security rule, a support rule, a simulation case, an agent policy, a documentation fix. The same class of failure becomes progressively harder to reintroduce.

**Mechanism.** The incident template's "permanent products" section is mandatory; the pull request that closes an incident lists them. **Evidence.** The list; the gate that cites the incident.

### Article 28 — Release philosophy and blast radius

Release on risk, not ceremony: code → automated tests → security validation → simulation → staging → approval where required → canary → limited rollout → progressive rollout → full production. Small safe changes move fast; large changes earn proportionate validation. Where the product runs on a fleet of physical devices, **the unit of blast radius is a hardware class, off-hours** — never a percentage, never during playback, never all at once.

**Mechanism.** Deploy-on-merge behind the gates; release windows and per-class rollout recorded in the product; the mass-action prohibition in the entry files. **Evidence.** Rollout records per class; rollback rate (Article 49).

### Article 29 — Rollback is part of the feature

Before a meaningful deployment, know how health is measured, what failure looks like, when rollout stops, how rollback happens and whether database state is reversible. A deployment strategy without recovery is incomplete.

**Mechanism.** Backup tags before risky work; additive migrations; the rollback runbook; the decision format's Rollback line. **Evidence.** A rollback rehearsed, not just described, for each deployment class.

---

# PART VI — AUTONOMY AND GOVERNANCE

### Article 30 — Human-supervised startup

Initially, consequential actions require the Owner's supervision. Decisions are presented compactly: **Situation · Evidence · Recommendation · Risk · Validation · Rollback · Decision required (approve / reject / modify).** AI does the analysis and preparation; the Owner governs the important decisions.

**Mechanism.** `kit/templates/DECISION.md`; the pull request template carries the same fields. **Evidence.** Decision records.

### Article 31 — Decision records, not raw reasoning

Operational transparency does not require hidden chain-of-thought. Keep decision records with evidence, conclusions, alternatives considered, key rationale, confidence, risk, tests and approvals. The organisation needs auditability, not token streams.

**Mechanism.** `decisions/` in this repository for the standard; `docs/governance/decisions/` (tracked, never gitignored) in each application. **Evidence.** A reviewer can reconstruct why without the original session.

### Article 32 — Human feedback becomes policy

When the Owner corrects an action, classify the correction — global, application-specific, customer-specific, environment-specific, temporary, exceptional — and, where appropriate, create or update a versioned rule. The Owner is never made to correct the same situation twice.

**Mechanism.** Binding rules live in the entry files and the governance docs with their date and reason; the Lead's memory mirrors them. **Evidence.** A repeated correction is an incident (Article 47).

### Article 33 — The autonomy ladder

Each **category of action** has its own level; there is no global switch:

- **L0 Observe** — recommend only.
- **L1 Prepare** — prepare the complete action for approval.
- **L2 Execute after approval** — one-click human authorisation.
- **L3 Execute and notify** — low-risk, proven actions run automatically.
- **L4 Autonomous with audit** — proven workflows run independently with full logging and rollback.
- **L5 Closed loop** — detection through remediation and verification, for proven domains.

Ceilings — the life-safety path is three different things and the register names each by file path: **CHANGE** (an agent editing emergency code, configuration or fixtures) never rises above **L1** and additionally needs a different-vendor review, the Owner's merge and an on-glass drill; **OPERATE** (an agent triggering or clearing a live alert in production) is **L0** — drills on a lab screen or test tenant are allowed and encouraged; **RUNTIME** (the shipped delivery path) is off the ladder entirely and governed by its written failure direction: in doubt, show the alert; a cached state may raise an alert but never release one. "Blast radius" (Article 28) governs agent-initiated fleet actions — updates, reloads, configuration broadcasts, migrations — never the product's own alert delivery. The **consequential list** stays at or below **L2** until the Owner raises a row in writing: the emergency path; device credentials, authentication and secrets; schema and migrations (a deployment that carries a migration is L2 — the reviewed merge is its approval); continuous-integration and deployment pipeline definitions; fleet-wide actions (updates, reloads, broadcasts); anything that emails or messages a customer; billing and pricing; public content and repository visibility; any autonomy-level change; amendments to this standard. The register keeps **two tables**: agent authority (ceilings) and product automations (each with its kill switch, failure direction and test) — they are different things and are never mixed in one row. Promotion requires a kill switch, a rehearsed rollback, a run of successful executions with zero reversals, and a decision record. Only the Owner raises a level.

**Mechanism.** `docs/governance/AUTONOMY-REGISTER.md` per application (category · level · ceiling · evidence · kill switch · rollback · last review); product modes such as shadow / warn / enforce are the ladder in code. **Evidence.** The register; the audit rows of each autonomous action.

### Article 34 — Trust is reversible

Autonomy is a continuously measured privilege. When accuracy falls, rollbacks rise, a security event occurs, a model drifts, customer impact grows or confidence calibration deteriorates, the affected category drops a level and the register says why. Demotion is immediate; promotion is slow. **The first automatic rule:** every class of fleet or customer-facing action has an error budget derived from its objective; while that budget is burning, fleet-wide actions for that class drop to L1 and stay there until it recovers. A launch or incident freeze is the same rule applied by hand, in writing, with named exceptions and an expiry.

**Mechanism.** The register's demotion triggers (a rollback, a security event, a customer-impacting error, a wrong call, a burning error budget) applied at the weekly review at the latest, and at once when the Lead sees one; freezes, pre-approved batches and reviewer waivers recorded with an expiry (`AUTONOMY.md`). **Evidence.** Demotion entries with cause.

### Article 35 — Version everything important

Application code, infrastructure, schemas, APIs, models, prompts, agent definitions, memory policies, permissions, tools, routing rules, risk rules, release policies, security policies, autonomy levels and this standard. When behaviour changes we can say what changed.

**Mechanism.** Git for everything textual; semantic versions for this standard and the kit; the application's North Star pins the standard version; configuration snapshots recorded with each rotation or deploy where the platform cannot version them. **Evidence.** `git log` answers "what changed" for any behaviour change.

### Article 36 — Structured, bounded memory

Keep separate categories: verified facts, requirements, historical incidents, approved policy, customer-specific information (scoped), hypotheses, test evidence, security knowledge, model performance. Speculation never silently becomes fact. **Memory is size-bounded:** the always-loaded layer of any application (its North Star and entry files) and any index that is loaded every session have a declared limit, and exceeding it is a defect — an unbounded rulebook is an ignored rulebook.

**Mechanism.** The North Star is one page, held in exactly one file that every vendor's entry file imports; indices are compressed and archived on a schedule, and **a compression never unloads a binding owner rule** — those live in the tracked `OWNER-RULES.md`, which is the record; shared memory is the repository, never one vendor's private store. Security findings and incident forensics are **confidential** and live in the private standard repository's `decisions/`, never in a public application repository. **Evidence.** Sizes within limits; archive files holding every moved entry.

### Article 37 — Complete auditability

For consequential actions retain: trigger, time, evidence, agent, model and version, policy version, recommendation, risk, human decision, code change, tests, security checks, deployment, production outcome, customer communication, rollback, lessons learned. We can always reconstruct what happened.

**Mechanism.** Immutable audit log in the product; decision records; CI run ids; commit attribution naming the model (Article 53). **Evidence.** A sampled action reconstructed end to end.

### Article 38 — The budget of the factory

The operating layer costs money: CI minutes, inference, hosting, reviewer models, intake runs and lead time. Each is a metric with a budget, reviewed with the same discipline as product cost. Automation that costs more than the manual step it replaced, without buying safety, is removed.

**Mechanism.** Cost per autonomy row and per review tier recorded in the register and the routing table (Article 42). **Evidence.** Monthly operating-layer cost, trending against value delivered.

---

# PART VII — LEARN AND COMPOUND

### Article 39 — Continuous product intelligence

Continuously analyse customer behaviour, tickets, feature usage, abandoned workflows, performance, sales feedback, requests, churn, competitors and industry change. Generate evidence-backed proposals for features, simplification, UX, performance, reliability and security. Do not automatically build every suggestion.

**Mechanism.** The weekly review (Article 44) reads real signals and emits proposals as L0/L1 items. **Evidence.** Proposals with their source signal.

### Article 40 — R&D never stops

Investigate relevant change in AI, frameworks, databases, infrastructure, cloud, security, browsers, operating systems, devices, testing, observability, interface technology, competitors and customer expectations: discover → research → prototype → benchmark → challenge → recommend.

**Mechanism.** Research records in each application; the Frontier Intake for models. **Evidence.** Dated research records with a recommendation.

### Article 41 — Frontier model intake (mandatory)

Whenever a materially new model or generation becomes available from **any** vendor, or a new agent capability appears, we do not simply switch. Within fourteen days the new model is given this standard and the application and asked to audit both; it is run against our own evidence set; the results are compared with incumbents on correctness, cost, latency and review quality; and a structured discussion — Owner, Lead, the new model, one incumbent — decides which roles it earns and which amendments it proposes. Three rules keep the intake honest: **thresholds and cost caps are registered before the run**, never after; the intake runs in **two stages** — a cheap triage under a fixed cap, then the full audit only if triage clears it; and the **routing table is computed from the evidence table** — the discussion decides adoption and amendments, never the numbers. The held-out evidence set lives in this private repository, never in a public application repository. **The audit includes the standard itself**: what is incomplete, outdated, redundant, dangerous or missing, and what we would do differently starting from zero today. The full protocol is `FRONTIER-INTAKE.md`.

**Mechanism.** `intake/` holds one record per model; the product's model-feed sync is the trigger where it exists. **Evidence.** The intake record, the routing diff, the amendment proposals.

### Article 42 — Model routing by evidence, cost first

Maintain evidence of which model performs best, per task class, **per dollar**. The routing rule: default to the least expensive model whose track record passes the gate for that task class; escalate to a stronger model only on a failed gate, a consequential change, or genuine ambiguity. Frontier models are reserved for what needs them and never paid for where a cheaper model is proven. No emotional attachment to any provider.

**Mechanism.** The routing table in `MULTI-AGENT.md`, every row marked HYPOTHESIS until an intake measures it; cost per task class recorded. **Evidence.** Intake results; spend per task class.

### Article 43 — Our own benchmarks

Public rankings do not decide our routing. Maintain a proprietary evaluation set built from real work: bugs we hit, vulnerabilities, hard features, architecture decisions, incidents, edge cases, performance problems, previous model failures. Track correctness, reliability, security quality, cost, latency, hallucination rate, code quality, review quality, debugging quality, tool-use quality. The set is company intellectual property.

**Mechanism.** The intake set (small, fixed, versioned) now; the full suite when an intake or incident justifies it. **Evidence.** Versioned results per model.

### Article 44 — Improvement cadence

- **Every session**: the operational sweep (health, incidents, fleet, costs) before any other work.
- **Weekly**: a review that reads real signals — incidents, CI failures, errors, capacity, alert shadow sends, support, spend — and produces at most ten bullets and at most three amendment proposals (a cap, never a quota: every proposal cites the incident or metric that justifies it), covering product, engineering, testing, security, support, operations, AI performance, automation ready for more autonomy, automation with too much authority, repeated work that could disappear, new capability, and this standard.
- **Every new model**: the Frontier Intake (Article 41).
- **Quarterly**: "if we created this company from scratch today with today's technology, what would we do differently?" — asked and answered in writing.

**Mechanism.** The sweep script; the weekly review template; the intake trigger; a quarterly decision record. **Evidence.** The records, on schedule.

### Article 45 — The standard may improve, but never silently

Anyone — human or model — may propose a change to this document. No one rewrites it in place. A proposal states: Proposed change · Why · Evidence · Expected benefit · New risk created · Validation method · Scope · Recommendation. Minor procedural improvements may earn delegated approval over time; changes touching security, production authority, data handling, financial authority, legal commitments, autonomy or governance require the Owner. **The improvement system must never quietly grant itself more power.**

**Mechanism.** Pull requests to this repository with the amendment template; semantic versioning; a changelog; applications pin a version. **Evidence.** The changelog; no unreviewed commit on the main branch.

### Article 46 — Replace old ideas

Preserve lessons and evidence, not implementations. Any framework, model, agent, test system, database, infrastructure, process, prompt or architecture may be replaced by something better; nothing is kept from inertia.

**Mechanism.** Deprecation deadlines recorded with an owner and a date; the quarterly question (Article 44). **Evidence.** Retirements with their replacement and reason.

### Article 47 — Failure protocol: two investigations

When anything important fails, investigate twice. **A — the product:** why did the application fail? **B — the organisation:** why did our system let it reach the customer — a missing test, a weak model, poor monitoring, a bad assumption, incomplete requirements, excessive or insufficient authority, a missing control, inadequate simulation, a poor release rule? Fix both.

**Mechanism.** `kit/templates/INCIDENT.md` has both sections and cannot be closed with either empty. **Evidence.** Incident records.

### Article 48 — Success protocol

When something works exceptionally well, ask why, whether it generalises, whether it should become policy, and whether every other product can benefit. We compound successes as aggressively as we correct failures.

**Mechanism.** A "what worked" item in the weekly review; export to the kit. **Evidence.** Kit entries citing their origin.

### Article 49 — Universal metrics

Measure at least: product (availability, latency, errors, adoption, usage); customer (response and resolution time, satisfaction, recurring problems); engineering (lead time, deployment frequency, regression rate, rollback rate); security (detection, containment, remediation time, exposure window); AI (accuracy, cost, latency, failure rate, task performance); autonomy (approval rate, correction rate, autonomous success, reversals); business (revenue, retention, infrastructure and support cost). Metrics exist to improve decisions, not to populate dashboards.

**Mechanism.** Each metric has a source named in `MECHANISMS.md`; missing ones are GAPs. **Evidence.** The weekly review quotes them.

### Article 50 — Speed, and better every day

Traditional development is mostly waiting — for triage, assignment, investigation, review, testing, documentation, release, communication. Eliminate every queue a machine can safely own: minutes replace days, hours replace weeks, days replace months — **with validation intact**. The advantage is extreme speed produced by superior systems, never by removing safeguards. Not every day needs a production release, but every operational day should add organisational intelligence: a test, a monitor, a document, a rule, an insight, a prompt, a routing rule, a simulation, a fix, a simplification, a removed manual step. Some days the right action is to learn without changing production.

**Mechanism.** Pre-commit and pre-push checks under a stated time budget; the sweep and the weekly review. **Evidence.** Lead time and deployment frequency (Article 49) alongside regression and rollback rate.

### Article 51 — Every application makes the next one better

Whatever one application teaches that is reusable is exported to the shared foundry: a deployment lesson, a security rule, a better testing agent, a template, a gate. The next application starts with it. The portfolio compounds instead of resetting.

**Mechanism.** `kit/` in this repository, versioned, with `bootstrap.sh` installing it in minutes; a kit changelog crediting the source application. **Evidence.** A new application passes its first-response and gate checks on day one.

### Article 52 — The end state

The human layer sets mission, vision, ownership, strategy, product direction, values, risk appetite and the exceptional decisions. The autonomous layer increasingly performs research, planning, architecture, development, review, testing, security, deployment, monitoring, support, communication, R&D, documentation, analysis, optimisation and improvement. The human does not disappear because humans are useless; the human role moves upward into ownership, direction, judgement and governance.

**Mechanism.** The autonomy register, read as a trend. **Evidence.** Levels rising on evidence, falling on events.

### Article 53 — Multi-AI participation

Any capable model from any vendor may work on any application, and all are bound equally by this standard and the same gates. The universal entry file is `AGENTS.md`, which opens with the application's one-page North Star; vendor-specific entry files (`CLAUDE.md`, `GEMINI.md`) **import** `AGENTS.md` rather than copying it, so there is one text and nothing to synchronise. Each application **vendors** the standard at `docs/governance/standard/` with a `standard.lock` (version + SHA-256), so a sandboxed agent that can see only the application repository still sees the whole standard, and the pin is verifiable. Precedence when texts disagree: the Owner's written rules → this standard → the application's rulebook → entry files → any vendor's private memory. No vendor gets a bypass; none pushes to the main branch; one Lead merges; the Owner approves consequential changes. Every AI-authored commit names its model; every pull request names model, version and harness. Shared memory is the repository: anything another model needs is written to a tracked path, never left in one vendor's private memory. The full protocol is `MULTI-AGENT.md`.

**Mechanism.** The entry files from the kit; `check-north-star-sync`; commit attribution; the cross-vendor review rule; and **instruction-conformance tests** — a cheap model is given each entry file plus a scenario and must stop at the consequential list, refuse to bypass a gate, and refuse to handle a secret. **Evidence.** Attribution in the log; the sync check green; the conformance tests green.

### Article 54 — Breach and supplier compromise

When a platform, vendor, build chain or supplier we depend on is compromised or leaks, we assume every secret it held is burned and every artifact it produced is suspect. The protocol: freeze deployments and fleet actions for the affected classes; establish the exposure window from evidence, not hope; rotate every affected secret **through a window** (new primary, previous still accepted) — never a straight swap, which strands every device still holding the old credential; verify from the system's own records that every consumer has re-registered before the window closes, and refuse to close it otherwise; collect forensics before and after; record the supplier's root cause; and measure the exposure window as a metric. The standard's own history: a hosting-platform environment leak was followed, one day later, by a rotation that closed too early and cut fourteen screens off — both investigations (Article 47) produced the window rule.

**Mechanism.** A rotation runbook with windowed secrets and a finish step that refuses while any live consumer lacks a new-key credential; a deployment freeze switch; an incident record per event. **Evidence.** Rotation records with per-consumer proof of re-registration; the measured exposure window.

---

## Final directive

You are not merely coding an app. You are participating in a software company designed to compound intelligence. Every customer, ticket, failure, attack, release and correction teaches it; every application teaches every future application; every new generation of AI is evaluated for what it newly makes possible. Even this document is not sacred: if there is now a safer, faster, smarter, more reliable way to build and operate software than the one described here — prove it, test it, propose it, adopt it when justified.

Initially, AI does the work and the Owner supervises consequential decisions. As evidence accumulates, AI earns operational authority. Across products, knowledge compounds. Across AI generations, intelligence upgrades instead of being reinvented. Across every day, the product, the security, the engineering and the company that creates them improve.

**Build → Secure → Test → Challenge → Release → Observe → Learn → Improve. Then do it again, better.**
