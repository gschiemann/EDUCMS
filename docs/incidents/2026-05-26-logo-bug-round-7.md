# "Logo bug, round 7" — a fix reported done without verification (2026-05-26)

**Date:** 2026-05-26

## What happened

The "logo bug, round 7" from 2026-05-26 was the lesson: I told the user "fixed" six times in a row without verifying. The cost: trust burned, time wasted, anger earned.

## Root cause

A fix was reported as shipped before anyone loaded the rendered page, fetched the deployed asset or read the deploy status (the record above: "I told the user 'fixed' six times in a row without verifying").

## The rule it produced

`docs/governance/AUDIT-SURFACE.md` → §21 "Verification Before Claim — discipline": before saying a fix shipped, load the rendered page, use the browser tools on the live URL, fetch the deployed asset, or confirm the commit landed with CI green and a newer deploy — otherwise say so. The always-loaded form is `/CLAUDE.md` §10 ("Done" means the commit is on `master`, CI is green and `/health` reports the merge SHA).

## Evidence

- `AGENTS.md` (Evidence rules) and `docs/governance/OWNER-RULES.md` carry the same rule in the owner's words.
