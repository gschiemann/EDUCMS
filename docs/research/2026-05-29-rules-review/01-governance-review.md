# VenueOS / EDU CMS — Governance & Rules Review (suggestions only)
**principal-engineer + tech-writing lens, 2026-05-29. Read CLAUDE.md (2,135 lines) + 30 memory files + 47 root .md + ~80 docs/ + 11 CI workflows + husky + package READMEs, cross-checked vs actual code. NO files changed.**
North star applied: "leader in CMS AND sports venue, cutting-edge, easiest UX (app does the work for them), safe + world-class practice."

## Headline
**Your OPERATING governance is genuinely strong; your STATIC governance is a graveyard.** Two doc-sets that don't know about each other:
1. **Living layer** (current, battle-earned, excellent): CLAUDE.md, the `memory/` files, CI workflows, husky hooks, `docs/research/2026-05-28-opus48-audit/`, LAUNCH_STATUS, per-feature docs (OBSERVABILITY/FEATURE_FLAGS/BACKUP_AND_ROLLBACK/EP6N).
2. **Fossil layer** (~30 root `.md` + `docs/architecture/*`, all 2026-04-13, "swarm @BackendDev/@Orchestrator" voice, describing a to-be-built "School Digital Signage CMS" — none say "VenueOS," none know about multi-vertical/sports/the live pilot, several CONTRADICT shipped reality).
**Verdict: "world-class in motion, amateur at rest." Fix is ~70% deletion/consolidation, ~30% writing. You have a curation problem, not a knowledge problem (the 05-28 audit proves you know exactly where you stand).**

## CLAUDE.md
**KEEP (crown jewels):** rule #10 (Chromium-83 inset/gap/backdrop-filter w/ grep), rule #9 (verify render tree), env table (connection_limit=10, EMAIL_FROM gotcha), Standard Audit Surface §1-21 (the 3-lens DUF + Verify-Before-Claim = world-class), Agent Dispatch Protocol, Emergency section, Template Design Workflow.
**FIX:** "Chromium 83"→"83-87, assume the floor" (Android-11 Taurus=87; `inset` IS supported in 87 — the conclusion stays defensive but the version is a factual error undermining the rule). "Repo PUBLIC" (#5) vs `SECURITY_HYGIENE.md` "flip to PRIVATE" P0 — reconcile. "Last Updated 2026-05-16" already stale. **Too long (2,135 lines):** ~1,400 lines are ROADMAP (Sprints 7-13, V2, sports spec, pricing) interleaved with load-bearing rules → split to CLAUDE.md (~600, rules first 200) + `docs/roadmap/`. Add 1 sentence reconciling the 1-replica pin (`railway.json:27`) vs the "every replica's pmessage" emergency narrative.

## Memory files
**KEEP:** the `feedback_*` incident memories (db_pool_limit_one, no_inset_shorthand, audits_must_be_exhaustive, player_release_tagging, verify_green_before_test) + `reference_*` — superb institutional memory.
**FIX:** `user_role.md` (42d) still says K-12-only "EDU CMS," pre-VenueOS/pre-multi-vertical/pre-sports — misleading about what the company IS. `project_v1_pilot_locked.md` (33d) control model ("v1.1 behind flags default OFF") is being IGNORED in practice (sports/brand-shim/security waves shipped straight to master) — re-affirm or supersede. Run `consolidate-memory`: archive done `project_*` punchlists (canva_parity, agent_dispatch_queue "FIRE-READY", pre_demo_*), keep the rules. `feedback_no_silent_background_polls.md` is an orphan (not linked in MEMORY.md).

## Root .md fossil layer — VERIFIED contradictions with shipped code
| Doc | Claims "mandatory/done" | Reality (code-verified) |
|---|---|---|
| THREAT_MODEL/TEST_STRATEGY:20 | Socket.io + Redis adapter | NO Socket.io — raw signed WS + Redis pub/sub |
| RISK_REGISTER:7 | "rigid Row-Level Security (RLS)" | NO Postgres RLS — Prisma app-layer scoping |
| SECURITY_BASELINE:24 | "Mandatory malware scanning before READY" | NOT implemented (no ClamAV) — real gap, doc claims done |
| SECURITY_BASELINE:11-14 | 15-30min tokens + RT rotation, SameSite=Strict | NO RT rotation; 05-28 audit found 30-day-stale claims (P1-1) + NODE_ENV-gated revocation (P1-4) — OPPOSITE |
| docs/architecture/CI_CD_PLAN | ArgoCD/Flux, Terraform, Vault, dev→staging→prod, SAST | None — Railway+Vercel, push-to-master=prod, no staging. 100% fiction |
| GAP_REPORT:2 | "BLOCKING IMPLEMENTATION" | 6 weeks + a live pilot ago |
**Why it matters:** security docs that assert controls you don't have = dangerous false assurance to a district IT reviewer = exactly the "theater" your own `feedback_audits_must_be_exhaustive` rails against. A documented safeguard that isn't wired is worse than no doc.
**Rec:** move 2026-04-13 specs → `docs/archive/2026-04-original-design/` w/ "historical only" README; promote 3 to LIVING + truthful (THREAT_MODEL=Prisma-scoping-not-RLS, SECURITY_BASELINE=real token model + malware-scan as a KNOWN GAP w/ ticket, TEST_STRATEGY); keep+refresh `RBAC_MATRIX.md` (the one fossil still ~true). `LAUNCH_STATUS.md` DIRECT/PARTNER/BRIDGE/CLOSED taxonomy is excellent — keep, but it's 26d stale (pre-sports, pre-"only ~3 of ~30 wired") → refresh/rename `INTEGRATION_TIER_STATUS.md`.

## docs/** tree
**KEEP:** `docs/research/2026-05-28-opus48-audit/00-MASTER-SYNTHESIS.md` — your single most accurate artifact (every claim traced to caller/curl); ELEVATE + link from CLAUDE.md top as canonical "current state." OBSERVABILITY/FEATURE_FLAGS/EP6N/CTS docs (real, match code). `apps/edge/README.md` (exemplary — use as the README template).
**FIX:** archive `docs/architecture/*` (CI_CD/INFRASTRUCTURE/DEPLOYMENT — Terraform/K8s fiction). `docs/frontend/DESIGN_SYSTEM_RULES.md:23` mandates `backdrop-blur-md` — CONTRADICTS rule #10 on player surfaces (Taurus landmine); scope to dashboard + carve-out + note brand-vars win. `docs/PERFORMANCE.md` triggers on non-existent `main`/`develop` branches + oversells a11y (claims 0.95 floor while baseline tolerates 99 errors). `docs/BACKUP_AND_ROLLBACK.md` rollback paths hardcode `C:\Users\gschi\OneDrive\...` — you're on macOS now, every restore path wrong (same Windows/OneDrive staleness in SECURITY_HYGIENE). Add `docs/research/README.md` index.

## CI / husky / package READMEs
**KEEP (strongest ENFORCED governance):** husky pre-commit (lockfile + inset:0 block), pre-push (preflight), ci.yml (gitleaks, react-hooks zero-tolerance, a11y ratchet), taurus-safety/cross-browser/emergency-path/prod-smoke gates — above-bar for the stage.
**FIX (the most important safety fixes):** `ci.yml:38` **API tests `continue-on-error:true` — tests run but NEVER block merge** (the gap between "we have tests" and "tests protect master"; highest safety ROI, one line). `ci.yml:177` Trivy CVE scan also non-blocking + `:176` Trivy pinned `@master` (unpinned 3rd-party action in your security job). lighthouse continue-on-error too → 3 decorative gates the docs claim are enforced. `apps/api/README.md` = stock NestJS boilerplate (CircleCI/npm/AWS/Discord); `apps/web/README.md` = stock create-next-app — your 2 most important READMEs tell a new hire to use npm (you're pnpm) + deploy to AWS (you're Railway/Vercel). Most visible amateur tell. Rewrite off apps/edge.

## ADD (governance gaps, by north star)
**Safety/compliance (highest — K-12 + payments):** (1) real `COMPLIANCE.md` (FERPA/COPPA/PCI-SAQ-A/state privacy) — table-stakes in district RFPs, currently ZERO; sales-blocker. (2) data-retention + PII policy (Clever SIS coming). (3) upload malware-scanning: build OR document as accepted risk w/ ticket (`docs/SECURITY_GAPS.md` > a baseline that lies). (4) security-review cadence + Dependabot/Renovate + make Trivy HIGH/CRITICAL blocking. (5) incident-response runbook (breach / false emergency fire / data leak) — non-negotiable for enterprise/district.
**Observability/reliability:** (6) SLOs + alerting (emergency delivery latency, player uptime, API p99 — "know within 60s when emergency delivery degrades," not just "errors in Sentry"). (7) on-call/escalation doc.
**"App does the work for them" (your moat, under-governed):** (8) Integration Concierge = vision blurb in CLAUDE.md only → promote to `docs/concierge/` spec w/ DUF acceptance gates + UX SLA ("paste URL → working board <60s"). Docs are ~80% defensive / ~20% effortless — invert toward the north star. (9) formalize a "UX time-budget" standing gate (every feature: named happy-path <N clicks/<30s + screenshot proof), like Lighthouse for perf. (10) ONE Taurus-aware + brand-shim-aware design-system doc.
**Process:** (11) `docs/API_VERSIONING.md` (additive-only schema rule + how to deprecate without bricking kiosks). (12) `CONTRIBUTING.md`/START-HERE pointing to the right 5 docs (fixes the two-doc-set problem). (13) test-coverage floor for load-bearing paths (emergency/auth/billing/tenant-isolation), enforced.

## TOP 10 (if nothing else)
1. **Make API tests blocking — remove `continue-on-error:true` `ci.yml:38`** (+ Trivy `:177`). Highest safety ROI, one line.
2. **Archive the 2026-04-13 fossil layer** (~30 root + docs/architecture) → `docs/archive/` w/ "historical only."
3. **Fix security docs to match reality** (no RLS/Socket.io/malware-scan/RT-rotation) — a baseline that lies is the worst theater.
4. **Add COMPLIANCE.md (FERPA/COPPA/PCI) + data-retention** — sales-blocking for districts.
5. **Elevate 00-MASTER-SYNTHESIS to canonical "current state"** + link from CLAUDE.md top.
6. **Rewrite apps/api + apps/web READMEs** (stock boilerplate → off apps/edge).
7. **Resolve contradictions:** Chromium 83→83-87; backdrop-blur vs #10; 1-replica vs fan-out; public-vs-private repo.
8. **Promote Integration Concierge to a governed spec + UX-time-budget gate** (most on-north-star, least-governed).
9. **Split CLAUDE.md** (rules ~600 / roadmap → docs/roadmap; load-bearing rules in first 200).
10. **consolidate-memory + refresh user_role.md + project_v1_pilot_locked.md.**

## Verdict
Engineering DISCIPLINE in the living docs is world-class for the stage (incident-driven rules + enforced husky/CI gates beat most funded startups). The doc SET is not yet world-class: (1) a 30-file fossil layer contradicting the product, (2) security/compliance docs that OVERSTATE controls you lack while MISSING controls districts demand, (3) ~80% defensive / ~20% effortless (under-serves the "app does the work" moat). Fix = ~70% deletion/consolidation. Archive fossils, make advisory gates blocking, write the 4 missing safety/UX docs, reconcile the contradictions.
