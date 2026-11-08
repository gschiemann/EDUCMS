# Decision — make the risk-weighted gates required to merge (prepared for the owner)

Articles 16, 18, 19 · Phase 1 item #16/#18 · prepared 2026-10-31 by the lead · **applied 2026-11-02** on the owner's go (the ruleset lives in GitHub settings; CI/CD definitions are on the consequential list) · the merge-queue rule was **refused by GitHub** — see the last section.

| | |
|---|---|
| **Situation** | The ruleset "Master deploy safety" (id `15263898`, active on the default branch) requires only four *build* checks — `pnpm lockfile drift`, `API + workspace packages build`, `Web typecheck + build`, `Docker build + boot smoke test` — and blocks deletion and force-push. The gates that encode risk — the emergency-path e2e, tenant isolation, the Jest suites, "schema change ships a migration" — run but do not block; the admin role bypasses the ruleset "always"; and nothing requires a pull request, so direct pushes to `master` are allowed (406 since 2026-10-01). Railway and Vercel deploy on push. |
| **Evidence** | `gh api repos/gschiemann/EDUCMS/rulesets/15263898` on 2026-10-31; the mechanism map rows 16, 18, 45; 2026-09-16: a schema change with no migration file reached production because the gate that would have caught it did not exist yet — the same shape repeats for any gate that exists but does not block. |
| **Recommendation** | Add to `required_status_checks`: `chromium · Emergency path`, `webkit · Emergency path`, `Two-tenant × role isolation matrix`, `schema change ships a migration`, `Build, Lint & Test`. Add a `pull_request` rule (0 required approvals — GitHub forbids self-approval and there is one human; the rule's value is forcing the PR path and the checks). Keep the admin bypass for now (it is the owner), and record that the Lead currently acts under the owner's identity (Phase 1 identities item). |
| **Risk** | (1) Merge latency: the e2e gates take 10–20 minutes, so every merge waits for them — during the launch, a hotfix waits too; the owner's bypass remains for a true emergency and is logged by GitHub. (2) **The `paths-ignore` trap:** these workflows skip `docs/**` and `*.md`; a required check that never reports leaves a docs-only PR *pending forever*. So either (a) apply this after the gate workflows are changed to always report (a first job that detects a docs-only change and exits green, instead of `paths-ignore`), or (b) accept that docs-only PRs need a manual `workflow_dispatch` run or the owner's bypass. (a) is the right fix and is a Phase 1 workflow change. (3) A flaky e2e blocks merges; the emergency-path and tenant-isolation suites were green on master on 2026-10-31. |
| **Validation** | Read-only reads of the ruleset and the last 60 master runs; job display names copied from the workflow files (they are the status-check contexts). Not validated: the behaviour of a path-skipped required check on this repository (GitHub documents "pending"). |
| **Rollback** | `PUT` the original rule set back (below). Instant. |
| **Decision requested** | Approve applying it (a) now, accepting (2b) until the workflows are converted, or (b) after the launch freeze together with the workflow conversion. One-way door? No — reversible in one API call. |
| **Decision** | ~~(b) after the launch freeze~~ → **(a) apply now.** The owner lifted the hold on 2026-11-01 ("finish all our development"). Order: this workflow conversion merges first (the `changes` job in `deploy-reliability.yml`), then the lead applies the ruleset change above and records the result here. |

## The change, ready to apply

Save as `ruleset.json` (copy `integration_id` values from the existing entries — they identify GitHub Actions as the reporter), then `gh api -X PUT repos/gschiemann/EDUCMS/rulesets/15263898 --input ruleset.json`:

```json
{
  "name": "Master deploy safety",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [{ "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": { "required_approving_review_count": 0, "dismiss_stale_reviews_on_push": false, "require_code_owner_review": false, "require_last_push_approval": false, "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": { "strict_required_status_checks_policy": true, "required_status_checks": [
      { "context": "pnpm lockfile drift" },
      { "context": "API + workspace packages build" },
      { "context": "Web typecheck + build" },
      { "context": "Docker build + boot smoke test" },
      { "context": "schema change ships a migration" },
      { "context": "Build, Lint & Test" },
      { "context": "chromium · Emergency path" },
      { "context": "webkit · Emergency path" },
      { "context": "Two-tenant × role isolation matrix" }
    ] } }
  ]
}
```

## Rollback — the original (read 2026-10-31)

Rules: `deletion`; `non_fast_forward`; `required_status_checks` with exactly `pnpm lockfile drift`, `API + workspace packages build`, `Web typecheck + build`, `Docker build + boot smoke test`. Bypass: RepositoryRole 5, `always`. No `pull_request` rule.

## Applied 2026-11-02 — and what GitHub refused (recorded 2026-11-08)

**Applied.** After PR #219 merged (the gated jobs always report on pull requests, with `merge_group` triggers on the four gate workflows), the lead ran `gh api -X PUT repos/gschiemann/EDUCMS/rulesets/15263898` with the JSON above. GitHub records the update at 2026-11-01 18:57 Pacific (2026-11-02 02:57 UTC). Read back 2026-11-08: rules `deletion`, `non_fast_forward`, `pull_request` (0 approvals), `required_status_checks` with strict up-to-date and exactly the nine contexts listed above; one bypass actor, RepositoryRole 5, `always`. **Required to merge today is those nine checks, through a pull request.** `CLAUDE.md` §7 and §10 and `docs/governance/AUDIT-SURFACE.md` §17 say the same.

**Refused: the merge queue.** The same `PUT` with a tenth rule, `{ "type": "merge_queue", "parameters": { … } }`, came back `HTTP 422 — Invalid rule 'merge_queue'`, twice on 2026-11-02 with two parameter shapes. The payload is not the cause: this repository is owned by a user account (`gschiemann`, `owner.type = User`), and GitHub offers the merge queue to organization-owned repositories only — public ones, and private ones on GitHub Enterprise Cloud (https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue). The `merge_group` triggers and the docs-only stub jobs from #219 stay: they cost nothing on a repository without a queue, and they are exactly what the queue needs the day the repository moves under an organization.

**What stands in for it.** Strict up-to-date means every merge into `master` puts every other open pull request BEHIND. Landing several at once therefore goes one of two ways: `gh api -X PUT repos/gschiemann/EDUCMS/pulls/<n>/update-branch` per pull request after each merge (each update re-runs that PR's workflows, and the public repository's Actions concurrency is the bottleneck — eight armed PRs cost about 45 minutes a round on 2026-11-01), or a **release train**: one worktree cut from `origin/master`, `git merge --no-ff` of each reviewed branch in order (CI-changing branches first), one pull request whose body lists the pull requests it carries, checked once, merged once. #212 was the first, with eight branches. Cancel only the duplicate runs on the individual pull requests, never a train's gate workflows.

**Linked constraint.** Making the repository private on a personal GitHub Free account removes rulesets and branch protection altogether (`docs/DEPLOY.md`, "If it ever goes private again"), so the private-repository decision and an organization move belong together.

**Decision.** No organization move during launch week — the lead's recommendation to the owner in chat on 2026-11-02, with nothing asked of the owner. The move, and with it the merge queue, is a post-launch decision for the owner, taken together with the private-repository question. One-way door? No: GitHub transfers a repository to an organization with its pull requests, issues and Actions history and redirects the old URL, and the ruleset is re-applied with the one `PUT` above plus the merge-queue rule.
