# CI minutes before and after going private (2026-10-22)

**Question:** can CI fit GitHub Pro's 3,000 Actions minutes a month (target: 2,500 or less) once the repo is private?

**Short answer:** not on GitHub's own runners at the rate this repo commits. The changes in `ci/go-private-budget` remove about two thirds of the waste and drop no gate. But ~390 CI-triggering events a month (agent PRs plus master pushes) times ~44 billed minutes for a full gated run is still 13,000–18,000 minutes on GitHub-hosted 2-vCPU runners. There are two ways to land under budget:

1. **Recommended: self-hosted (or cheap third-party) runner.** Set the repo variables `CI_RUNNER` and `CI_RUNNER_PLAYWRIGHT`. Every heavy job then leaves GitHub's metered pool, and the projected billed minutes are **~1,500/month**. No workflow edit is needed.
2. **Hosted only:** ~13,000–18,000 minutes, which is ~$60–90/month of overage at $0.006/min. A spending limit can cap it, but at the cap CI stops.

Everything below is measured from the GitHub API except where a row says *est.*

## 1. Measured: the last 7 days (2026-10-15 → 2026-10-21, public repo)

How it was measured: `gh api repos/gschiemann/EDUCMS/actions/runs` per UTC day, then `/runs/{id}/jobs` for every run. Each job's `completed_at − started_at` is rounded **up** to a whole minute, which is how a private repo is billed. All runners were Linux (`ubuntu-latest`, `ubuntu-24.04`), so the multiplier is ×1 everywhere: no macOS or Windows jobs exist. Scripts: `measure2.mjs` / `analyze.mjs` (in the session scratchpad; rerun them by pointing them at any date range).

Caveat: the runs API's `created=YYYY-MM-DD` filter returned overlapping or empty sets around 10-18/10-19. 1,611 runs and 1,905 jobs were retrieved. `total_count` reported ~2,350 runs for the same window, so **treat every number here as a floor.** Deploy Reliability's own `total_count` for 10-15..10-22 is **104 runs** (67 PR + 37 push). The measured set below has 51.

**Billed in the window: 8,437 min. Projected (×30/7): ~36,200 min/month, at least.** That is 12× the Pro allowance. It costs nothing today only because the repo is public.

| Workflow | runs | jobs | billed (7 d) | / month |
|---|---:|---:|---:|---:|
| CI & Security (mostly the sharded E2E) | 50 | 486 | 4,253 | 18,227 |
| Deploy Reliability | 51 | 408 | 1,039 | 4,453 |
| Emergency Path | 51 | 102 | 633 | 2,713 |
| Cross-Browser | 39 | 82 | 490 | 2,100 |
| CodeQL default setup ("Push on master" + "PR #n", dynamic) | 54 | ~70 | 727 | 3,116 |
| Accessibility (axe-core) | 39 | 39 | 190 | 814 |
| Lighthouse CI | 35 | 35 | 158 | 677 |
| Tenant Isolation | 51 | 102 | 128 | 549 |
| Prod Smoke | 20 | 40 | 123 | 527 |
| Player Kotlin Check | 20 | 20 | 91 | 390 |
| Android Player APK (tags / dispatch) | 7 | 7 | 79 | 339 |
| 7 one-script guard workflows (Signing Secrets, Capability Registry, Mobile Perf, Integration Truth, OTA Wiring, Taurus Safety, Poster Freshness) | 357 | 357 | 428 | 1,834 |
| Keep API warm | 34 | 34 | 34 | 146 |
| Workflow failure → issue | 15 | 15 | 15 | 64 |
| Field Scripts | 11 | 11 | 11 | 47 |
| DB Backup | 5 | 5 | 5 | 21 |
| E2E DPR experiment (temporary, gone) | 1 | 2 | 33 | 141 |

| Trigger | runs | billed (7 d) | / month |
|---|---:|---:|---:|
| pull_request | 515 | 5,422 | 23,237 |
| push | 198 | 2,066 | 8,854 |
| dynamic (CodeQL) | 54 | 727 | 3,116 |
| schedule | 51 | 128 | 549 |
| workflow_dispatch | 7 | 79 | 339 |
| workflow_run | 15 | 15 | 64 |

Where the minutes actually go:

- **The sharded E2E suite ran on every PR push and every master push.** The 6 shards, 2 merge jobs and the build came to ~4,000 of the week's 8,437 minutes. Cancelled jobs (superseded runs and E2E caps) alone billed **2,387 minutes**.
- **Every job pays its own setup and its own rounding.** The seven one-script guard workflows cost ~1 billed minute each per push for ~20 seconds of checking. The same tree was installed and built in 4–6 different jobs per push (Build, Lint & Test; API build; Web build; Web Jest; a11y lint; E2E build; two Emergency Path legs).
- **Every master push re-ran what the PR had just proved** on the identical tree.
- **CodeQL default setup** (~3,100/month) and **GitHub secret scanning** stop being free once the repo is private (they need GitHub Advanced Security, which Pro does not include). That CodeQL line disappears from the bill, and Semgrep plus gitleaks take its place (§4).
- `keep-warm.yml` was `*/5 * * * *`. On the public repo GitHub throttled it to 6–7 runs a day. If a private repo ever honoured it, that would be 288 runs a day = **~8,600 min/month** by itself.

Durations on today's 4-vCPU public runners (job average, minutes): Build, Lint & Test 7.2 · Web Jest 4.3 · API build (+ non-blocking Jest) 3.9 · Web build 2.8 · a11y lint 2.8 · Docker 2.2 · Emergency Path 5.4 (chromium) / 6.1 (webkit) · Cross-browser holiday bridge 7.6 · WebKit E2E shard 13.2 · Chromium E2E shard 10.0.

## 2. What changed (branch `ci/go-private-budget`)

| Area | Before | After | Why it is safe |
|---|---|---|---|
| **Sharded E2E (~840 tests × 2 browsers)** | every PR push + every master push | `e2e-full.yml`: **Mon + Thu** on master, any PR with the **`full-e2e` label**, or manual dispatch | The suites that must never break still run on every change: Emergency Path (lockdown/all-clear + player native-video + offline, both engines, blocking), Web Jest, API Jest, web build and Docker boot. A regression elsewhere is named within ≤ 4 days with a commit range, and the label covers risky UI changes before merge. |
| **API Jest (blocking)** | `ci.yml` Build, Lint & Test, plus a second **non-blocking** copy in DR api-build | one blocking run inside DR **"API + workspace packages build"** (full install so argon2 loads) | The same suite runs once instead of twice. The non-blocking copy could never fail anything. |
| `pnpm run build` in Build, Lint & Test | third build of api + web + renderer | removed | DR builds every one of them as its own checks. |
| jsx-a11y + rules-of-hooks ESLint, Web Jest | 2 extra jobs | steps inside DR **"Web typecheck + build"** | Same scripts and baselines; one install instead of three. |
| 7 guard workflows + Tenant Isolation + schema-has-migration + APK-tag | 10 jobs in 9 workflows | one DR job, **"Static guards"**. Every check step runs even when an earlier one fails. | Same scripts and same arguments. The "two-tenant matrix" job was a second run of `src/tenant-isolation/*.spec.ts`, which the full blocking API Jest already runs. |
| Emergency Path | 2 runners (each installed and built the web app) | 1 runner, both projects, one build. Called from DR. | The same three specs on the same two engines. |
| Trivy image scan + SBOM | every push and PR (a second full image build) | `container-scan.yml` ("Supply Chain Scan"): **nightly** + any PR/push touching `Dockerfile*`, `pnpm-lock.yaml`, `**/package.json`, `.trivyignore.yaml` | A new CVE is a calendar event, caught within a day. Dependency changes are still scanned before merge. App source cannot add an OS or library package. |
| Production dependency audit | every push and PR | same workflow, same triggers as Trivy | Same reasoning. |
| Cross-browser WebKit canaries | every PR push + nightly | non-draft PRs touching boards, shims, widgets, `src/lib`, the canaries or deps, plus **Mon/Wed/Fri** on master | Those paths are what the canaries test. The schedule catches drift. |
| axe-core page audit | every PR + nightly | **weekly** + dispatch | The per-change a11y gate (jsx-a11y ratchet) still blocks every new violation. |
| Lighthouse | every PR | **weekly** + dispatch | The per-change bundle-budget ratchet still blocks growth. |
| Prod Smoke + WebKit nav | every master push (waits for the deploy, billed) + nightly | **twice daily** + dispatch (`gh workflow run prod-smoke.yml`) | It still exercises production daily. Run it by hand after a deploy you need verified. |
| keep-warm health sweep | `*/5` (throttled to ~every 3–5 h) | **every 3 h** (≤ 240 min/month) | Same as the real cadence today. Move real 5-minute outside-in monitoring to a free uptime monitor (checklist). |
| Docs-only PRs | required checks never reported, so the PR could not merge without admin bypass | DR always runs. The `changes` job skips jobs with `if:`, so required checks report "skipped", which counts as passing. | `scripts/ci-changed-areas.cjs` fails **open** (any doubt means everything runs) and is unit-tested (`scripts/__tests__/ci-changed-areas.test.cjs`). |
| Draft PRs | full run on every push | detection only. **"Ready for review"** triggers the full run on the same commit. | A draft cannot merge. |
| Master push of an already-verified PR | full re-run | skipped **only** when the pushed tree is byte-identical to a PR head that was up to date with master and whose latest DR run passed every job the change needs | Same tree, same workflow, green: a re-run proves nothing new. A direct push, or a merge of a stale or red PR, runs everything. |
| Runner | hard-coded `ubuntu-latest` / `ubuntu-24.04` | `${{ vars.CI_RUNNER \|\| 'ubuntu-latest' }}` and `${{ vars.CI_RUNNER_PLAYWRIGHT \|\| 'ubuntu-24.04' }}` on every heavy job | Unset means exactly today's runners. |
| SAST | CodeQL default setup (public-only) | **Semgrep**, diff-aware on every non-draft change (report-only, `SEMGREP_BLOCKING` switch) + full-tree nightly | See §4. |
| Secret scan | gitleaks (skipped on docs-only pushes) + GitHub secret scanning | gitleaks on **every** push and PR, docs included | GitHub's scanning goes away when the repo is private, so gitleaks is now the only secret scanner. |

The gates the brief names all remain, per change:

- Deploy Reliability: api-build, web-build, docker-build, lockfile, schema-has-migration
- API Jest
- Emergency Path
- gitleaks
- taurus-safety
- mobile-perf guard

The four required check names are unchanged ("pnpm lockfile drift", "API + workspace packages build", "Web typecheck + build", "Docker build + boot smoke test").

**Sized for 2 vCPU / 7 GB:**

- API Jest and Web Jest run with `--maxWorkers=2` and `NODE_OPTIONS=--max-old-space-size=4096`.
- `next build` runs with a 4 GB heap (measured 5.23 GB peak RSS on the 7 GB class).
- Emergency Path serves a prebuilt bundle.
- The E2E matrix is re-cut: Chromium 1 worker × 4 shards, WebKit 1 worker × 6 shards.

## 3. After: projected billed minutes per month

Event rate (Deploy Reliability `total_count`, 10-15..10-22): **~251 PR-push runs + ~139 master pushes a month** (~27 PRs/week). Per-job minutes are the measured averages above ×1.3 for CPU-bound jobs on 2 vCPU (*est.*; the previous private period, 08-01→09-14, needed the same worker and heap caps). Each is rounded up.

A full gated run (one event that touches app code) costs about **44 billed minutes** on hosted runners:

| Job | min |
|---|---:|
| changes | 1 |
| lockfile | 1 |
| guards | 2 |
| API (install + Jest + build) | 9 |
| Web (lint + Jest + build + checks) | 11 |
| Docker | 3 |
| Emergency Path | 12 |
| Semgrep diff | 3 |
| renderer (¼ of events) | 1 |
| gitleaks | 1 |

A light event costs **2**: `changes` + gitleaks (docs-only, draft, or an already-verified merge).

| Workflow | Before (/month, measured floor) | After — A: hosted, today's habits *(est.)* | After — B: hosted + draft PRs *(est.)* | After — C: `CI_RUNNER` set *(est.)* |
|---|---:|---:|---:|---:|
| Deploy Reliability (incl. called Emergency Path, Semgrep, guards) | 4,453 + 2,713 + 1,834 + 549 | 13,100 | 8,800 | **390** (`changes` only) |
| CI & Security | 18,227 | 390 | 390 | **390** (gitleaks) |
| Supply Chain Scan (Trivy, dep audit, Semgrep full) | (in CI & Security) | 460 | 460 | 0 |
| E2E (full), 2×/week | (in CI & Security) | 1,040 | 1,040 | 0 |
| Cross-Browser | 2,100 | 1,320 | 870 | 0 |
| Player Kotlin Check | 390 | 470 | 300 | 0 |
| Prod Smoke | 527 | 300 | 300 | 0 |
| Accessibility (axe) + Lighthouse | 1,491 | 44 | 44 | 0 |
| Keep API warm | 146 (8,600 if honoured) | 240 | 240 | 240 |
| Android Player APK | 339 | 340 | 340 | 340 |
| DB Backup + failure → issue + Field Scripts | 132 | 150 | 150 | 105 |
| CodeQL default setup | 3,116 | 0 (not available on private Pro) | 0 | 0 |
| **Total billed** | **≥ 36,200** | **≈ 17,850** | **≈ 12,930** | **≈ 1,465** |
| Overage at $0.006/min over 3,000 | — | ≈ $89 | ≈ $60 | **$0** |

Reading it:

- **A → C is the decision.** With a runner set, everything but `changes`, gitleaks, keep-warm, the DB backup, the APK release (it holds the signing keys, so it stays on GitHub's ephemeral VMs) and the failure-issue routine runs off the metered pool. That is **~1,500 minutes**, under the 2,500 target, and it does not depend on how fast the agents commit.
- **B needs no money but needs habits:** open agent PRs as drafts, mark them ready once, and merge through PRs rather than pushing to master directly.
- **The first private week's real numbers replace these estimates.** Rerun `measure2.mjs` / `analyze.mjs` (the Settings → Billing → Usage page reports the same thing per workflow). The two estimates most likely to be off are the 2-vCPU slowdown factor and the share of master pushes that are verified merges.

## 4. Semgrep (replaces what going private removes)

- **Per change:** DR job "Semgrep SAST (diff-aware, report-only)", container `semgrep/semgrep:1.179.0`, `scripts/ci-semgrep.sh diff`. It uses the OSS registry packs `p/default`, `p/typescript`, `p/javascript`, `p/nodejs`, `p/react` and `p/github-actions` with metrics off. No account and no token; code never leaves the runner. `--baseline-commit` = the PR base, or the previous master tip on a push, so **only findings the change introduces** are reported. The existing backlog is never noise.
- **Nightly:** "Semgrep SAST (full tree, nightly, report-only)" in Supply Chain Scan, which inventories existing findings.
- **Output:** a job-summary table plus a `semgrep-<sha>.sarif` artifact. Code Scanning upload needs GHAS, which Pro lacks.
- **Excluded from scanning** (`.semgrepignore`): generated board HTML and shims, docs/scratch, and build output.
- **Switch to blocking for NEW findings:** set the repository variable `SEMGREP_BLOCKING=true`. No code change. `full` mode never blocks.
- **Verified locally:** the same image and command over the last 5 master commits ran 230 rules on 56 changed files with 0 findings, exit 0, in 4m45s on Docker Desktop (*est.* 2–3 min on a runner).

**gitleaks** (`ci.yml`, the only job left in "CI & Security") runs on every push and PR, with no paths-ignore. It scans full history on master pushes and the diff on PRs. It needs no `GITLEAKS_LICENSE` because the repo belongs to a personal account; the license is only required for organization-owned repos.

## 5. Master health at the time of the change

- Every master workflow's latest run was green at 2026-10-22 15:00 UTC.
- Cross-Browser nightly has been **green for 9 consecutive nights** (10-13 → 10-22). The last red was 10-12.
- The `k12-menu-bridge.cjs` lunch-carousel timeout was fixed in `8484bb6f` ("k12 menu suite waits for the board to handle edit mode"), and today's nightly log shows every lunch board passing the carousel and editor-pause checks. Nothing is left to fix there.
