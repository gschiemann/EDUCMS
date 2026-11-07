# Four agent reports lost to a context compaction (2026-05-28)

**Date:** 2026-05-28

## What happened

2026-05-28: Greg dispatched 4 research agents on 2026-05-27, all 4 returned full reports (~11,800 words total), I never persisted them, context compacted, reports vanished from chat. Recoverable only because every agent's full transcript persists at `/private/tmp/claude-501/<project>/<session>/tasks/<agentId>.output` — that's the EMERGENCY path, not the design. Greg's words: *"why did we lose our agents work your wasting my fucking money now, dont do that shit ever again."*

## Root cause

The lead never wrote the returned reports to disk before the context compacted (stated in the record above). The agents' transcripts were the emergency path, not the design.

## The rule it produced

`docs/governance/AGENT-DISPATCH.md` → rule 8, "Persist agent work to disk THE MOMENT it returns", to a tracked path (`docs/handoffs/<date>-<topic>/`) before the next user-facing summary. `AGENTS.md` carries it as "Never discard agent work".

## Evidence

- The agents' transcripts at `/private/tmp/claude-501/<project>/<session>/tasks/<agentId>.output`.
