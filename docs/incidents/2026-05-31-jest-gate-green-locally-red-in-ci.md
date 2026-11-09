# A test gate made blocking on a local-green run (2026-05-31)

**Date:** 2026-05-31

## What happened

On 2026-05-31 the lead flipped the API Jest gate to blocking off a local-green run and turned Deploy Reliability red on every subsequent push — the *operator* caught it, not the lead. That is the failure mode this rule kills.

## Root cause

From the rule that stays in `docs/DEPLOY.md`:

> `pnpm preflight` is NOT proof CI will pass. It skips Docker AND it runs on *your* machine, where native modules (argon2; `bcrypt` is no longer a dependency) are already built and cached. The raw GitHub runner is a fresh `pnpm install --frozen-lockfile` that does **not** rebuild those bindings for the Jest job — so a suite that's green locally can have 5 suites *fail to load* in CI (`Cannot find module .../argon2.node`).

## Why our system let it reach a customer

The API Jest gate was made blocking on the strength of a local run, where native modules are already built and cached, and no one watched the pull request's checks to completion before the change was treated as safe. The operator caught the red CI, not the lead.

## What pins it

- `.github/workflows/scheduled-failure-issue.yml` lists "Deploy Reliability" among the workflows whose failure opens (or updates) an issue and fires the on-call routine, so a red run is now surfaced by the system rather than only by the operator.
- `.github/workflows/deploy-reliability.yml`, step "Run API tests (Jest)": `continue-on-error` was restored with the reason and the condition for removing it written beside it (add a native-binding rebuild, verify CI green, then drop the flag).
- `scripts/venueos.cjs` (`status`) prints the runs for the current commit and treats "still running" and "no runs at all" as not a pass.

None of these stops someone flipping a gate to blocking on a local-green run; they shorten the time to notice. The flip itself is a pull request, and a pull request's own checks are the first run on a fresh runner, so the remaining discipline is the standing rule in `docs/DEPLOY.md` to watch them to green.

## What worked

The operator noticed the red Deploy Reliability runs on subsequent pushes. The record does not say what contained it.

## The rule it produced

`docs/DEPLOY.md` → "Post-push: WATCH CI TO GREEN — do not declare "done" before it resolves": after every push of a branch, watch the pull request's checks to completion and react to red before telling anyone anything shipped. `AGENTS.md` rule 5 and `/CLAUDE.md` §10 carry it.

## Evidence

- `gh pr checks <PR-number> --watch` is the command the rule prescribes.
