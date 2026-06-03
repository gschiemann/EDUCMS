# Dev-process hygiene audit (2026-06-02)

Triggered after the 83 GB leftover-worktree pileup: *"what else is out there
like this — audit the development process and ensure we're world-class."*
Evidence-based sweep for the same failure class (accumulating, unmonitored
state / cruft / unscanned risk). Findings + what was fixed.

> **2026-06-02 follow-up — "do them all, we have no customers yet, start clean
> and stay clean."** Every item that was FLAGGED below is now RESOLVED (see the
> RESOLVED section). All shipped behind a clean non-incremental tsc, full
> preflight build, and all 9 CI workflows green on `8de4f3ba`.

## FIXED (with before/after evidence)

| # | Finding | Evidence | Action |
|---|---|---|---|
| 1 | **154 leftover agent/session worktrees, 83 GB** under `.claude/worktrees/` (May 9–28); git scanning them made every command slow/erroring | `git worktree list` = 154; `du` = 83 G | Removed all (unlock→remove→prune); branches deleted; backup manifest on Desktop. `.claude/worktrees` → 16 K. **Guardrail:** `scripts/cleanup-worktrees.sh` + `pnpm worktrees:clean` + CLAUDE.md merge-cycle rule. |
| 2 | **`.git` = 408 MB, never gc'd** — 210 MB of garbage `tmp_obj_*` (interrupted writes) + 27,862 loose objects, **0 packed** | `git count-objects -vH`: garbage 210 MB, in-pack 0 | rm garbage + `git gc` → **`.git` = 22 MB**, 0 loose, 0 garbage, 25,516 packed (20.9 MB). |
| 3 | **8 stale remote branches** on origin (6× `worktree-agent-*` + `fix/deep-widget…` + `claude/catch-up…`) | `git branch -r` | All verified **merged** into master → deleted. origin now = just `master`. |
| 4 | **Cross-Browser "react render smoke" flaky** (the red ✗'s the operator kept seeing) | failed all retries on a contended run, green on no-change re-run | warm `/player` route once + boot headroom (`dab2d1f`); all CI checks green. |

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

## RESOLVED (2026-06-02 — "start clean and stay clean") — was FLAGGED

| # | Finding | Resolution + evidence |
|---|---|---|
| 5 | **Dependency vulns: 1 CRITICAL + 9 HIGH** (`passport-saml@3` CVE-2025-54419; node-`tar`; transitive `undici`/`basic-ftp`/`fast-uri`/`tmp`). Root cause: no routine vuln scan. | **`pnpm audit`: 1 critical + 9 high → 0 critical + 0 high** (commit `e8de8f96`). • `passport-saml` **removed** — it was only `require()`d in a try/catch stub, SAML is hard-gated off (0 enabled tenants), and the SSO suite (26/26) only exercises the pre-`require` guard paths → behavior-preserving. • `argon2 0.31→0.44` **dropped `@mapbox/node-pre-gyp`→`tar` entirely** (now `node-gyp-build`), killing every node-tar HIGH at the root instead of force-overriding `tar@7` into node-pre-gyp@1 (which would have risked the Alpine argon2 build). Verified on the real Railway image: **Docker build + boot smoke + healthcheck green (1m25s).** • `sanitize-html 2.17.2→2.17.3`. • `pnpm.overrides` patched floors for the rest — **all scoped to the dev-only `@wdio/cli` Android-E2E tree, none shipped to prod.** Routine scan now wired into `pnpm hygiene:deps`. **Residual: 21 moderate + 2 low, all dev/build-tooling transitive (esbuild/turbo/postcss/the @wdio tree) — not runtime-reachable; accepted + documented.** |
| 6 | **193 tags = 90 stale `backup/*`** + `broken/*` + `pre-stash-clear*` snapshot noise. | **Pruned 92 local + 90 remote** junk tags → 0 backup tags. Manifest (name+sha, every tag recoverable) backed up to `~/Desktop/venueos-pruned-tags-manifest-*.txt`. **Kept all real release/milestone tags** (player-v* ×73, manager-v* ×21, milestone/* ×5). Tags 193 → 101. |
| 7 | **"172 `@ts-ignore`"** suppressions. | Inflated count — 169 were in `.next/` generated type files. **Only 3 real source suppressions, all the same CSS-custom-property pattern**, fixed properly (commit `0d3d7e51`): `BrandingLivePreview` widened to `React.CSSProperties & Record<\`--${string}\`, string>`; both Scrapbook widgets dropped `['--x' as any]` + `@ts-ignore` for a single `as React.CSSProperties` cast. **0 source suppressions remain.** Verified via full Next.js build. |
| 8 | **Task list: ~16 stale `in_progress`.** | Reconciled **conservatively** (never blanket-close — false "done" is the cardinal sin). Closed **#8 domain migration** (curl-verified: venue-os.app live, HTTP 200, canonical). Reviewed the other ~15 and confirmed they're **genuinely active or umbrella tasks, not stale-done** → left open. |
| 9 | **Held `…/settings/pos/page.tsx`** uncommitted. | **Committed** (`8de4f3ba`) — it completes the multi-location StoreMappingPanel UI that pairs with the already-shipped backend (`/pos/connections/:id/locations`, `/tenants/children`). Verified via full Next.js build; banner updated from stale "on the roadmap" to accurate "catalog sync is live." |

## DURABLE GUARDRAIL (the "world-class, never-again" mechanism)

`scripts/hygiene-check.sh` + **`pnpm hygiene`** (`hygiene:deps` for the network vuln pass) — one command, read-only, that reports every axis above with ✅/⚠️ and the fix command: leftover worktrees, `.git` object/garbage health, dirty tree, stale local/remote branches, backup-tag clutter, dependency CVEs. Run it routinely (and it's wired into the Agent Dispatch pre-flight). Catches the next "83 GB" early instead of when it breaks git.

Root-cause theme across every finding: **accumulating state with no monitor.** The fix in each case is the same shape — a guard that surfaces it before it compounds.
