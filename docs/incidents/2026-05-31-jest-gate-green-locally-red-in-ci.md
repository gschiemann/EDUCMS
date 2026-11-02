# A test gate made blocking on a local-green run (2026-05-31)

**Date:** 2026-05-31

## What happened

On 2026-05-31 the lead flipped the API Jest gate to blocking off a local-green run and turned Deploy Reliability red on every subsequent push — the *operator* caught it, not the lead. That is the failure mode this rule kills.

## Root cause

From the rule that stays in `docs/DEPLOY.md`:

> `pnpm preflight` is NOT proof CI will pass. It skips Docker AND it runs on *your* machine, where native modules (argon2; `bcrypt` is no longer a dependency) are already built and cached. The raw GitHub runner is a fresh `pnpm install --frozen-lockfile` that does **not** rebuild those bindings for the Jest job — so a suite that's green locally can have 5 suites *fail to load* in CI (`Cannot find module .../argon2.node`).

## The rule it produced

`docs/DEPLOY.md` → "Post-push: WATCH CI TO GREEN — do not declare "done" before it resolves": after every push of a branch, watch the pull request's checks to completion and react to red before telling anyone anything shipped. `AGENTS.md` rule 5 and `/CLAUDE.md` §10 carry it.

## Evidence

- `gh pr checks <PR-number> --watch` is the command the rule prescribes.
