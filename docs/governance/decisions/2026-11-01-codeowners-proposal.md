# Decision — an owner gate on the consequential paths: CODEOWNERS, or a quoted written go (proposal)

Articles 16, 33 · Phase 1 item "CODEOWNERS + ruleset" · prepared 2026-11-01 by Claude Sonnet 5.5 for the lead · **a proposal only: no `.github/CODEOWNERS` file exists or is created by this change, and the ruleset is untouched.** The ruleset and `.github/**` are on the consequential list, so applying either is the owner's decision.

| | |
|---|---|
| **Situation** | Seven paths decide whether an alert reaches a panel, who can sign in, what the database looks like, what CI enforces and what the rules say: `apps/api/src/emergency/**`, `apps/api/src/security/**`, `apps/web/src/app/player/**`, `apps/player/**`, `packages/database/prisma/**`, `.github/**`, `docs/governance/**`. Nothing mechanical makes the owner approve a change to them: his approval is a sentence in chat (owner rule 2026-10-31: "a written go in chat; the lead merges"), and a pull request that touches them can merge on the four build checks alone. Two ways to add a gate are on the table. |
| **Evidence** | **Ruleset** "Master deploy safety" (read 2026-11-01): `deletion`, `non_fast_forward`, `required_status_checks`; one bypass actor, `always`; no pull-request rule; no classic branch protection. **One collaborator** on the repository (the owner, admin), and the last 20 merged PRs were all opened by that one account — the Lead opens PRs through the owner's `gh` login. **Volume** (`gh pr list --state merged`, 93 PRs merged 2026-09-20 → 2026-11-01): **61 (66 %)** touched at least one of the seven paths — web player 40, APK 25, emergency 11, Prisma 11, `.github` 8, governance 3, security 2; **26 (28 %)** touched one of the five paths other than the two player directories. These are lower bounds (the API caps a PR's file list at 100). **Standard:** Register A and `AUTONOMY.md` make a change to the emergency path "≤ L1 plus a different-vendor review, the owner's merge and an on-glass drill"; owner rules outrank the standard, and the owner's rule turns "the owner's merge" into "merge on the owner's written go". |
| **Recommendation** | **Option B now; Option A only when its prerequisites exist.** B keeps today's workflow and makes the owner's go visible and checkable; A is the stronger control but, with one GitHub account doing both authoring and approving, it either deadlocks or is bypassed. Details below. |
| **Risk** | See the two options. Priority served: security and privacy over speed (Article 3); neither option touches the alert delivery path itself. |
| **Validation** | Nothing was applied. Volume numbers computed from the merged-PR file lists on 2026-11-01. **Unverified:** how GitHub's "require review from Code Owners" behaves on this repository when the sole code owner is also the PR author (GitHub documents that an author cannot approve their own pull request); the extended check in Option B is described, not built. |
| **Rollback** | Option B: delete the added rule from `pr-provenance.yml`. Option A: delete the CODEOWNERS file and set `require_code_owner_review` back to `false` with one `PUT` of the ruleset, as in `2026-10-31-required-checks-ruleset.md`. Both are two-way doors; A also changes an owner rule, which is the owner's call. |
| **Models involved** | Builder: Claude Sonnet 5.5 (Claude Code subagent). Reviewer: none yet — this touches CI definitions and the approval model, so a different vendor (Codex or Gemini) should read it before the owner decides. |
| **Decision required** | Approve **B** now · approve **A** (and the prerequisites) · modify · reject. |
| **Decision** | (owner) · date |

## Option A — CODEOWNERS plus a code-owner review rule in the ruleset

*What it is.* A `.github/CODEOWNERS` file naming the owner for the seven paths (text at the end of this record), and the ruleset's `pull_request` rule with `require_code_owner_review: true`. A pull request that touches a listed path cannot merge until the owner approves it on GitHub. (How the approval-count setting interacts with the code-owner flag was not tested here.)

*What the owner would have to do differently.*

- **Click Approve on GitHub instead of saying "go" in chat** — in the GitHub mobile app or on the web, for each such pull request. At the last six weeks' rate that is about ten a week; two thirds of all PRs.
- **Change owner rule 2026-10-31** ("the owner does not operate GitHub or consoles"). That rule would need an amendment.
- Accept that the first click is useless until the Lead stops using the owner's account: **GitHub does not count an author's own approval**, and the Lead opens every PR as the owner. With the owner as the only code owner and also the author, the requirement can be met only through the ruleset's admin bypass — which already exists and is the same identity. A without identity separation adds a step and no control.

*Prerequisites (all Phase 1 identity work).* A distinct GitHub identity for the Lead (a machine user or GitHub App with write access and no `workflow` scope) so author and code owner differ; the owner's amendment above; the `pull_request` rule added to the ruleset; a decision on whether the admin bypass stays as break-glass (it should, and GitHub logs its use).

*What it gives.* A control GitHub enforces, which no agent can talk its way past.

## Option B — keep the workflow; the PR quotes the owner's go and CI checks the quote exists

*What it is.* An extra rule in `pr-provenance.yml` (same job, same report-only-first posture): when the pull request's changed files (`gh api repos/…/pulls/N/files`, already readable with the job's `pull-requests: read`) include any of the seven paths, the body must carry one line

```
Owner approval: "<the owner's words>" (chat, YYYY-MM-DD)
```

or, while the owner has not yet said go, `Owner approval: awaiting the owner's written go`. In blocking mode the check passes only on a quote, so the pull request cannot merge on a required check until the Lead pastes the quote — the act the owner's "go" authorises. Editing the body re-runs the job (`edited` is already a trigger).

*What the owner would have to do differently.* Nothing. He keeps saying "go" in chat. The Lead pastes the words into the PR body before merging.

*What it gives.* An omission becomes a red check, and a false quote becomes a deliberate act, timestamped in the edit history GitHub keeps for a PR body, instead of a forgotten step. It also forces the model name and the approval onto the page where a different-vendor reviewer sees them.

*What it cannot give.* **It proves a quote was typed, not that it was said.** The Lead and the owner are one GitHub identity today, so nothing in the repository can tell a real "go" from an invented one; the record of what was said lives in the chat transcript. Like the commit-trailer check it is attribution, not authentication, and it lives in the pull request's own tree: a PR can edit it, which is why `.github/**` is on the list.

## Why B first

| | A | B |
|---|---|---|
| Enforced by GitHub, not by the Lead | yes | no |
| Works with one GitHub account | **no** (deadlock, or the bypass) | yes |
| Changes the owner's workflow | yes (an approval click; an owner rule amended) | no |
| Needs new identities first | **yes** | no |
| Cost to build | a file and a ruleset edit, after the identities | ~30 lines in a workflow that already exists |
| Closes the "agent merged without a go" gap | fully, once identities exist | partly: it makes the gap visible and checkable |

B ships this week and does not block the road to A: when the Lead has its own identity, A is a file and one ruleset call, and B's line becomes the owner-facing summary A's approval refers to.

## Candidates to add to the list (not in the lead's seven)

Named by the autonomy register or the rotation runbook, and not covered by a seven-path rule: `apps/api/src/realtime/redis.service.ts` (the fan-out HMAC gate — "a forged alert is a life-safety event"); `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` (the hard stops live in the first); `docs/SECRET-ROTATION.md`, `scripts/railway-rotation.mjs`, `scripts/rotation-renewal-guard.cjs`, `scripts/guard-destructive-db.cjs`; the deploy definition (`Dockerfile`, `railway.json`, `scripts/railway-start.sh`). `apps/api/src/screens/**` (the manifest's `emergency` field) is also a register path, but its controller alone is 8,697 lines and every screen-facing API change lands there: listing the directory would make most API PRs need the owner, so it needs a narrower pattern before it goes on any list.

## Proposed CODEOWNERS — NOT IN EFFECT

Shown as text so the owner can read exactly what A would say. It would live at `.github/CODEOWNERS`; it is deliberately not there. A trailing slash matches the whole directory, so `/apps/player/` covers what the lead's `apps/player/**` names. GitHub ignores an owner without write access, so every line below names the one account that has it.

```
# PROPOSED — not in effect. See docs/governance/decisions/2026-11-01-codeowners-proposal.md
/apps/api/src/emergency/        @<owner-login>
/apps/api/src/security/         @<owner-login>
/apps/web/src/app/player/       @<owner-login>
/apps/player/                   @<owner-login>
/packages/database/prisma/      @<owner-login>
/.github/                       @<owner-login>
/docs/governance/               @<owner-login>
```
