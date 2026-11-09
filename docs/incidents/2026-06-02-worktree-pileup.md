# 154 leftover agent worktrees, 83 GB (2026-06-02)

**Date:** 2026-06-02

## What happened

The 83 GB worktree pileup wasn't the only accumulating-cruft failure; a process audit that day also found a **408 MB never-gc'd `.git`** (210 MB of garbage `tmp_obj_*` + 27,862 loose, 0 packed → `git gc` brought it to 22 MB), **8 stale merged remote branches**, **90 stale `backup/*` tags**, and **unscanned dependency CVEs** (passport-saml critical + tar/undici highs).

The pre-dispatch checklist and the merge cycle in `docs/governance/AGENT-DISPATCH.md` keep the operative form of the story in code comments:

> On 2026-06-02 this reached 154 leftover trees / 83 GB and made every git command slow/erroring (the operator caught it, not the lead — never again).

> The 83 GB / 154-tree pileup (2026-06-02) was caused by exactly this step being skipped: work handed back, then the locked ~540 MB tree left behind forever.

## Root cause

Root cause was always the same: *accumulating state with no monitor.*

## Why our system let it reach a customer

The root cause is accumulating state with no monitor: finished agent worktrees, loose objects in the repository, stale branches and tags, and unscanned dependency advisories had nothing watching them. The operator, not the lead, noticed that every repository command had become slow or erroring.

## What pins it

- `scripts/hygiene-check.sh`
- `scripts/cleanup-worktrees.sh`

## What worked

The operator noticed the slow repository. The process audit that day found and cleaned the other accumulated state, and garbage collection took the repository from 408 MB to 22 MB.

## The rule it produced

`docs/governance/AGENT-DISPATCH.md` → the STANDING RULE (2026-06-02) in the merge cycle, step 4 of the pre-dispatch checklist, and "Workspace hygiene — `pnpm hygiene`".

## Evidence

- `pnpm worktrees:status` and `pnpm hygiene` are the monitors the rule prescribes.
