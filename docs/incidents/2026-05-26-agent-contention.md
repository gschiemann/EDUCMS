# Agents sharing one working tree (2026-05-26, follow-up 2026-05-29)

**Date:** 2026-05-26 (the misattribution below: 2026-05-29)

## What happened

The Integration Concierge service files were wiped twice from contention before this rule landed.

The IntegrationDiscoveryService was wiped TWICE this way before the rule landed.

Follow-up, 2026-05-29: A 5-agent read-only mobile-UX audit fleet dispatched WITHOUT worktrees dirtied the main tree's `next.config.ts` + `tsconfig.json` and left orphaned `assets/page.tsx` / `templates/page.tsx` edits — which the lead then MISATTRIBUTED to an innocent worktree-isolated fix agent (whose transcript proved 100% of its edits were worktree-scoped).

## Root cause

Agents that wrote code or ran the app shared the lead's working tree. The rule records the diagnosis in one sentence:

> The chaos that prompted this rule wasn't agents disobeying — it was the lead skipping pre-flight discipline.

## The rule it produced

`docs/governance/AGENT-DISPATCH.md` → rule 1 (worktree isolation is mandatory), rule 1b (any agent that runs the app gets a worktree), rule 1c (assert the main tree is clean before and after a batch), the pre-dispatch checklist and the anti-patterns.

## Evidence

- Transcripts of the agents involved persist under `/private/tmp/claude-501/<project>/<session>/tasks/<agentId>.output`, which is how the 2026-05-29 misattribution was disproved.
