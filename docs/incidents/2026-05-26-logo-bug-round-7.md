# "Logo bug, round 7" — a fix reported done without verification (2026-05-26)

**Date:** 2026-05-26

## What happened

The "logo bug, round 7" from 2026-05-26 was the lesson: I told the user "fixed" six times in a row without verifying. The cost: trust burned, time wasted, anger earned.

## Root cause

A fix was reported as shipped before anyone loaded the rendered page, fetched the deployed asset or read the deploy status (the record above: "I told the user 'fixed' six times in a row without verifying").

## Why our system let it reach a customer

A fix was reported as done six times without anyone loading the rendered page, fetching the deployed asset or reading the deploy status. The record names no gate or review that would have stopped the claim; the rule it produced is a discipline written into the audit surface and the rulebook.

## What pins it

- `.github/workflows/pr-provenance.yml`, step "Check the PR body states Evidence and Validation (report-only)": on every pull request it warns when the body has no `Evidence` line, no `Validation` line, or still carries the template's hint text for Validation (`.github/PULL_REQUEST_TEMPLATE.md`). A reader of the PR sees at once that no one said what was tested.

This pins that a pull request must SAY what was verified; it cannot prove the verification happened, and it does not see a "fixed" said in chat. It is report-only (`continue-on-error`) and does not block a merge. The deployed-commit half of the rule is read by `scripts/venueos.cjs` (`status`: local HEAD against the deployed health endpoint commit and CI), which is a manual command.

## What worked

Not recorded.

## The rule it produced

`docs/governance/AUDIT-SURFACE.md` → §21 "Verification Before Claim — discipline": before saying a fix shipped, load the rendered page, use the browser tools on the live URL, fetch the deployed asset, or confirm the commit landed with CI green and a newer deploy — otherwise say so. The always-loaded form is `/CLAUDE.md` §10 ("Done" means the commit is on `master`, CI is green and `/health` reports the merge SHA).

## Evidence

- `AGENTS.md` (Evidence rules) and `docs/governance/OWNER-RULES.md` carry the same rule in the owner's words.
