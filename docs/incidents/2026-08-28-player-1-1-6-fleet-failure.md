# The player 1.1.6 fleet failure (2026-08-28 audit, fixed by 2026-08-30)

**Date:** 2026-08-28 (audit); 2026-08-30 (verified and fixed)

## What happened

Born from the 1.1.6 fleet failure (a Codex audit of 2026-08-28, verified and fixed by 2026-08-30): screens sat "ONLINE" and content-dead for DAYS behind an ignored `requiresRePair`, a 401 loop whose failure counter never grew, three disagreeing token stores, and watchdogs satisfied by any live JS event loop.

## Root cause

Four separate facts were being treated as one. The rule that came out of it states them:

> A reliable player continuously proves FOUR SEPARATE FACTS — never let one stand in for another: (1) the Android process is alive; (2) the device credential is valid or proactively renewing; (3) the latest assigned manifest was fetched and applied; (4) that content is visibly loaded.

## The rule it produced

`apps/web/src/app/player/CLAUDE.md` → "Player Reliability — non-negotiable", rules 1–17.

## Evidence

- Findings that stayed in the rules: the first fix for rule 4 bounded only the headers and its own test codified the hole (deep-audit F1); rule 8: "230 fires / 0 escalations was the live proof of the old broken math."
- `docs/handoffs/` holds the prior-session context.
