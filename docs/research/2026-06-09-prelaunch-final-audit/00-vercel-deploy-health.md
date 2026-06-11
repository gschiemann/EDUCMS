# Vercel deploy health — 2026-06-09 (post-cf5772ae)

> Workflow: "Exhaustively verify VenueOS production health after cf5772ae + map every failing
> Vercel deploy to its cause" (4 agents). Triggered by Greg: "vercel had errors check everything".

## Verdict: PRODUCTION IS HEALTHY — the Vercel "errors" are Dependabot preview builds only

### Live production checks (all green)
- **Web routes** — `/`, `/login`, `/signup`, `/pricing`, `/pair`, `/panic`, `/terms`, `/privacy`,
  `/reset-password/request`, `/player` → all HTTP 200, zero redirects, zero anomalies.
- **API health** — `/health` 200 (db ok, redis ok), `/health/ready` 200 (not 503),
  `/health/emergency-path` 200 (db + redis + **ws_signer** chain verified).
- **Deployed commit matches master HEAD** `cf5772ae` (the 2026-06-09 audit-fix batch).
- The 2 most recent **Production** deploys on master: both Ready. Master's lockfile is in sync.

### The 3 failing deploys — all Preview, all the same root cause
| Deploy | Branch | PR | Root cause |
|---|---|---|---|
| educms-m0jy3wa4b | dependabot/npm_and_yarn/apps/web/minor-and-patch | #40 (22 web bumps) | `ERR_PNPM_OUTDATED_LOCKFILE` — package.json bumped, lockfile not regenerated |
| educms-bj6kg71ik | dependabot/npm_and_yarn/apps/api/minor-and-patch | #38 (28 api bumps) | same |
| educms-dbl6rwhpu | same branch, earlier commit | #38 | same |

Dependabot bumps specifiers (e.g. next 16.2.6→16.2.7, react 19.2.4→19.2.7, @nestjs/* →11.1.26,
@supabase/supabase-js →2.108.0, stripe →22.2.0, zod →4.4.3) **without** regenerating
`pnpm-lock.yaml`; Vercel's CI-default `--frozen-lockfile` install refuses. 7 Dependabot PRs open
(#33–#41).

### Remediation options (none urgent — production unaffected)
1. Per branch: `pnpm install --no-frozen-lockfile` + commit the lockfile → preview goes green.
2. Vercel "Ignored Build Step": skip previews on `dependabot/*` (kills the noise; GitHub CI still validates).
3. Consolidate wanted bumps onto one branch on master, one lockfile regen, let Dependabot auto-close.
4. Close the PRs if the bumps aren't wanted now.

Note: the boards-probe agent of this workflow died on a session limit; board render health was
separately verified the same day (28/28 click-edit chromium+webkit, 18/18 holiday WebKit).
