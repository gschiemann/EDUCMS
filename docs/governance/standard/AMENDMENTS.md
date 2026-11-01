# Amendments — the standard may improve, but never silently

Companion to Article 45. Anyone — human or model — may propose a change to any file in this repository. No one changes it in place.

## The proposal

Every amendment is a pull request whose description carries these eight fields (`.github/PULL_REQUEST_TEMPLATE.md`):

**Proposed change** · **Why** · **Evidence** (the incident, metric, intake or review that justifies it — an amendment with none is declined) · **Expected benefit** · **New risk created** · **Validation method** · **Scope** (which articles, which applications) · **Recommendation**.

## Classes and who approves

| Class | What | Version | Approval |
|---|---|---|---|
| Patch | Wording, clarity, a corrected path, a changelog fix | `x.y.Z` | the Lead, after a review by a different vendor |
| Minor | A new article or mechanism; a new template; a charter article changed | `x.Y.0` | the Lead proposes, the Owner approves |
| Major | Anything touching security, production authority, data handling, financial authority, legal commitments, autonomy levels or governance itself | `X.0.0` | **the Owner, in writing** |

Minor procedural improvements may earn delegated approval over time, recorded in `AUTONOMY.md`'s register for this repository. **The improvement system never grants itself more power:** a change that would raise any autonomy level or widen any permission is Major, whoever proposes it.

## Process

1. Open the PR with the template filled in. Cite the evidence.
2. A model from a different vendor than the author reviews Minor and Major changes.
3. The approver merges. The `CHANGELOG.md` entry and the version bump are part of the same PR.
4. Each application updates its vendored copy (`docs/governance/standard/`) and `standard.lock` through the kit, in its own reviewed PR.

## Enforcement

The main branch accepts no direct commits. On a plan that supports rulesets (GitHub Pro, or a public repository) this is enforced by a ruleset requiring a pull request and the Owner's review on Major paths; until then it is enforced by the Lead-merges rule and audited by the changelog, and the gap is recorded in this repository's own `MECHANISMS.md`.

## Where proposals come from

The weekly review (at most three, each citing an incident or metric — a cap, never a quota), a Frontier Intake, an incident's "organisational failure" investigation, or anyone who sees a rule that is incomplete, outdated, redundant, dangerous or missing.
