# Dev-process hygiene audit (2026-06-02)

Triggered after the 83 GB leftover-worktree pileup: *"what else is out there
like this — audit the development process and ensure we're world-class."*
Evidence-based sweep for the same failure class (accumulating, unmonitored
state / cruft / unscanned risk). Findings + what was fixed.

## FIXED (with before/after evidence)

| # | Finding | Evidence | Action |
|---|---|---|---|
| 1 | **154 leftover agent/session worktrees, 83 GB** under `.claude/worktrees/` (May 9–28); git scanning them made every command slow/erroring | `git worktree list` = 154; `du` = 83 G | Removed all (unlock→remove→prune); branches deleted; backup manifest on Desktop. `.claude/worktrees` → 16 K. **Guardrail:** `scripts/cleanup-worktrees.sh` + `pnpm worktrees:clean` + CLAUDE.md merge-cycle rule. |
| 2 | **`.git` = 408 MB, never gc'd** — 210 MB of garbage `tmp_obj_*` (interrupted writes) + 27,862 loose objects, **0 packed** | `git count-objects -vH`: garbage 210 MB, in-pack 0 | rm garbage + `git gc` → **`.git` = 22 MB**, 0 loose, 0 garbage, 25,516 packed (20.9 MB). |
| 3 | **8 stale remote branches** on origin (6× `worktree-agent-*` + `fix/deep-widget…` + `claude/catch-up…`) | `git branch -r` | All verified **merged** into master → deleted. origin now = just `master`. |
| 4 | **Cross-Browser "react render smoke" flaky** (the red ✗'s the operator kept seeing) | failed all retries on a contended run, green on no-change re-run | warm `/player` route once + boot headroom (`dab2d1f`); all 10 CI checks green. |

## CLEAN (verified — no action needed)

| Axis | Result |
|---|---|
| **Secrets — working tree** | No real keys (only a UI placeholder `sk-ant-api03-…`). |
| **Secrets — FULL git history** | `git log -p --all` scan: **no real keys ever committed** (critical for a public repo). |
| **.env files (×3)** | All gitignored (root + apps/api + packages/database). |
| **Skipped / `.only` / fake-green tests** | None in any `*.spec.ts`. |
| **Large blobs in history** | Largest = 2.2 MB jpg; pack = 20.9 MB → lean history, no committed binaries. |
| **uploads/ dir** | Only `.gitkeep` tracked; dir gitignored. |
| **.gitignore** | Covers node_modules / .next / dist / *.tsbuildinfo / .turbo / .env. |

## FLAGGED — need a decision or a discrete tested change (NOT done unilaterally on the live release branch)

| # | Finding | Recommendation |
|---|---|---|
| 5 | **Dependency vulns: 1 CRITICAL + several HIGH.** `passport-saml@3.2.4` (SAML sig-verification CVE GHSA-4mxg-3p6v-xgq3 — already tracked #199, SAML not live) + transitive `tar` / `undici` highs. Root cause: **no routine vuln scan** → accumulated unseen. | (a) Add a `pnpm audit` gate (now in `pnpm hygiene:deps`). (b) Discrete tested bump: pnpm overrides for tar/undici; migrate `passport-saml`→`@node-saml/passport-saml` before enabling SAML. |
| 6 | **193 tags = 90 stale `backup/*`** (Apr 16–May 18, superseded) + 73 `player-v*` releases + 30 other. | Prune the 90 backup safety tags (keep recent + all release tags). Operator's safety net → offered, not auto-deleted. |
| 7 | **172 `@ts-ignore` / `@ts-nocheck`** suppressions across apps/packages. | Type-safety debt; schedule a sweep (CLAUDE.md says strict, no `any` without reason). |
| 8 | **Task list: ~16 stale `in_progress`** tasks (several shipped). | Reconcile carefully (don't blanket-close — false "done" is the cardinal sin). |
| 9 | **Held `apps/web/src/app/[schoolId]/settings/pos/page.tsx`** uncommitted (POS store-mapping UI). | Commit or revert — operator's call. |

## DURABLE GUARDRAIL (the "world-class, never-again" mechanism)

`scripts/hygiene-check.sh` + **`pnpm hygiene`** (`hygiene:deps` for the network vuln pass) — one command, read-only, that reports every axis above with ✅/⚠️ and the fix command: leftover worktrees, `.git` object/garbage health, dirty tree, stale local/remote branches, backup-tag clutter, dependency CVEs. Run it routinely (and it's wired into the Agent Dispatch pre-flight). Catches the next "83 GB" early instead of when it breaks git.

Root-cause theme across every finding: **accumulating state with no monitor.** The fix in each case is the same shape — a guard that surfaces it before it compounds.
