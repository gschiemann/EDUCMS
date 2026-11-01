# Decision — make the risk-weighted gates required to merge (prepared for the owner)

Articles 16, 18, 19 · Phase 1 item #16/#18 · prepared 2026-10-31 by the lead · **not applied** — the ruleset lives in GitHub settings, and changing it is the owner's decision (CI/CD definitions are on the consequential list).

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
