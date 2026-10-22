# Go-private day checklist (owner)

Do these in order. Nothing here was done for you: the repo's visibility, plan and settings are yours to change. Merge PR `ci/go-private-budget` **first** (while the repo is still public, its CI is free).

## 0. Before you flip (any day this week)

- [ ] **Merge the CI budget PR** and watch master go green: Deploy Reliability, CI & Security, and the first nightly Supply Chain Scan.
- [ ] **Decide the runner** (see `01-ci-minutes.md` §3). With GitHub's runners alone, CI will cost about $60–90/month over the Pro allowance at today's commit rate. To stay at $0:
  - **Option 1, self-hosted runner (recommended).**
    - **Machine:** one Ubuntu 24.04 VM with 8 vCPU / 16 GB (e.g. Hetzner CPX41 / CCX23, roughly €15–30/month), running **two** runner processes so two jobs can run at once.
    - **Software:** Docker Engine, `git`, `curl`, Node is not needed (jobs install it), Google Chrome stable (the renderer tests use `/usr/bin/google-chrome`), and **passwordless sudo** for the runner user (`playwright install --with-deps` runs apt).
    - **Register both runners:** repo → Settings → Actions → Runners → New self-hosted runner, labels `self-hosted,linux,x64,venueos`.
    - **Set the variables:** Settings → Secrets and variables → Actions → **Variables**: `CI_RUNNER` = `venueos` and `CI_RUNNER_PLAYWRIGHT` = `venueos`. Nothing else changes. To roll back, delete the two variables.
    - **Security:** a self-hosted runner executes whatever a workflow says. It is safe on a **private** repo with no outside collaborators. Never attach it to a public repo or allow fork PRs to run on it.
    - **Cost note:** GitHub announced (Dec 2025) and then postponed a $0.002/min platform fee on self-hosted minutes. Even if it returns, 13,000 min would be about $26/month.
  - **Option 2, a cheaper hosted-runner provider** (Ubicloud, Blacksmith, WarpBuild, …): install their GitHub App, then set `CI_RUNNER` / `CI_RUNNER_PLAYWRIGHT` to their Ubuntu 24.04 label. This gives them read access to a private repo's code, so that is your call. Check their current price and free tier.
  - **Option 3, hosted only:** leave both variables unset and accept the overage. Open agent PRs as **drafts** and mark them ready once (that roughly halves the cost), and merge via PRs instead of pushing to master directly.
- [ ] **Outside-in uptime monitoring.** `keep-warm.yml` now runs every 3 h instead of every 5 min. For a real 5-minute "the API is down" alarm, create a free UptimeRobot or Better Stack **keyword** monitor:
  - URL `https://api-production-39a1.up.railway.app/api/v1/health`
  - keyword `"db":"ok"`
  - second monitor on `/api/v1/health/emergency-path`
  - alert email = your `PLATFORM_ALERT_EMAILS` address

- [ ] **⚠️ PLAYER OTA — do this BEFORE the flip.**
  - **Why:** the API's OTA code (`apps/api/src/player-ota/player-ota.controller.ts`) reads the release catalogue and downloads APK assets from `api.github.com/repos/gschiemann/EDUCMS/releases…`. It sends a token **only if `GH_TOKEN` or `GITHUB_TOKEN` is set**. On a public repo the anonymous call works; on a private repo it **404s**, every update check fails closed to "up to date", and the fleet silently stops updating.
  - **Check:** Railway → API service → Variables. `GH_TOKEN` must be present.
  - **If it is missing:** create a fine-grained token at github.com → Settings → Developer settings → Fine-grained tokens. Scope it to **only** the EDUCMS repo with **Contents: read** and **Actions: read** (the artifact fallback reads Actions artifacts). Set it as `GH_TOKEN` on the Railway API service.
  - **Verify after the flip:** a test screen's update check, or `/super/field-builds`, still lists the current release. Note the expiry date of the token and put a renewal reminder on your to-do list.

## 1. GitHub plan

- [ ] github.com → Settings (your account) → **Billing and plans** → upgrade to **GitHub Pro** ($4/month, or $48/year). Pro is what keeps **rulesets / branch protection on a private repo**; Free + private loses them (learned 2026-09).
- [ ] Billing → **Spending limit for Actions**. Set it to **$0** if you chose Option 1; then overage is impossible, and if a month ever runs dry, CI pauses instead of billing. With Option 3 set it to the most you will pay (e.g. $60). Remember that at the limit **every** job stops, including the nightly DB backup, while Railway and Vercel keep deploying.
- [ ] Billing → Usage: note the Actions minutes so far this month (the reset is the 1st).

## 2. Flip visibility

- [ ] Repo → Settings → General → **Danger Zone → Change repository visibility → Private**. Type the repo name to confirm.
- Effects you will see right away:
  - CodeQL default setup and GitHub secret scanning / push protection turn **off**. Semgrep (DR job + nightly) and gitleaks (CI & Security, every push) replace them.
  - Stars and watchers from people without access are removed.
  - Forks of a private repo are deleted for anyone without access.

## 3. Re-check what visibility can change

- [ ] **Rulesets:** Settings → Rules → Rulesets → **"Master deploy safety"** must say **Active** (it needs Pro on a private repo). Required checks should still be:
  - `pnpm lockfile drift`
  - `API + workspace packages build`
  - `Web typecheck + build`
  - `Docker build + boot smoke test`

  Since 2026-10-22, API Jest runs **inside** "API + workspace packages build", so it is now required too.
- [ ] **Optional, recommended:** also require `Emergency path / Emergency path (chromium + webkit)`. It reports "skipped" when a change cannot affect it, so docs-only PRs still merge.
- [ ] **Branch protection:** none is configured today (the ruleset does the job). Nothing to redo.
- [ ] **Secrets:** Actions secrets (`PROD_SMOKE_*`, `RELEASE_*`, `SUPABASE_*`, `DB_BACKUP_*`, …) are **unaffected** by visibility. Nothing to re-enter.
- [ ] **Variables:** confirm `CI_RUNNER`, `CI_RUNNER_PLAYWRIGHT` (if you chose Option 1 or 2) and optionally `SEMGREP_BLOCKING` are present.
- [ ] **Actions permissions:** Settings → Actions → General. "Allow all actions" stays as is. Under "Fork pull request workflows", make sure running workflows from fork PRs is **not** enabled for outside collaborators.

## 4. Deploy integrations (they use GitHub Apps, which work on private repos)

- [ ] **Vercel:** Vercel dashboard → the web project → Settings → **Git**. It should still show `gschiemann/EDUCMS` connected. Then check github.com → Settings → Applications → Installed GitHub Apps → **Vercel** → Repository access. It must include EDUCMS ("All repositories", or EDUCMS selected). Push any small commit and confirm a Vercel deployment starts.

  **Hobby-plan caveat:** Vercel Hobby deploys private repos only for commits authored by the account owner. Commits authored by bots or agents with a different git email may be **blocked** ("Git author must have access"). Check that the agents commit as you (`Greg Schiemann` / your email). If deploys stop, that is the cause.
- [ ] **Railway:** Railway → the API service (and `renderer`) → Settings → **Source**. It should still show the repo. Then check github.com → Settings → Applications → **Railway** → Repository access, which must include EDUCMS. Confirm the next push deploys (`curl https://api-production-39a1.up.railway.app/api/v1/health` shows the new `commit`).
- [ ] **Other apps that read the repo:** Settings → Applications → Installed GitHub Apps. Anything that only worked because the repo was public (badges, public links in docs, raw.githubusercontent URLs used by a device or script) will now 404. Search the code for `raw.githubusercontent.com/gschiemann/EDUCMS` before flipping. The player fetches APKs through the API (signed Supabase URLs) and GitHub Releases with an authenticated token, so it does not depend on the repo being public. Still, verify one OTA check after the flip: `/super/field-builds` or a test screen's update check.

## 5. After the flip (same day)

- [ ] Push a small commit through a PR and watch it go green. With Option 1, the heavy jobs should show your runner's name.
- [ ] Run one of each scheduled workflow by hand so you know they work private: Actions → **DB Backup** → Run workflow, then **Supply Chain Scan** → Run workflow.
- [ ] Update **CLAUDE.md, "For AI Assistants" rule 5**. Replace the "Repo is PUBLIC again…" paragraph with something like:

  > **Repo is PRIVATE** (`https://github.com/gschiemann/EDUCMS`) since <date>, on GitHub Pro (rulesets stay on). Actions minutes are metered: 3,000/month on 2-vCPU runners, every job billed rounded up to the minute. CI is budgeted for this (`docs/research/2026-10-22-go-private/`): heavy jobs run on `vars.CI_RUNNER`; full E2E is scheduled or label-triggered (`full-e2e`); open agent PRs as drafts and mark them ready once. GitHub secret scanning and CodeQL are gone; gitleaks (every push) and Semgrep (diff-aware per change, full nightly) replace them. Treat every commit as if it could become public again: no credentials, keys, customer names or PII.

  Also update the "Last Updated" stamp at the bottom of CLAUDE.md.
- [ ] Update the memory note `project_repo_private_gate_ci_minutes_2026_10_12.md` (it says "stay public until CI < ~3,000/mo").

## 6. First week

- [ ] Day 7: Billing → Usage → Actions. Compare with `01-ci-minutes.md` §3 and adjust:
  - E2E twice a week → weekly
  - Cross-browser three times a week → weekly
  - prod-smoke twice daily → daily
- [ ] When Semgrep's diff runs have stayed quiet for a week, set `SEMGREP_BLOCKING=true`.
