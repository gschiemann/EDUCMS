**Scope:** deploy, health, CI gates, repository visibility and rollback — the part of the old single-file `CLAUDE.md` that is about getting a change to production and knowing it arrived. `/CLAUDE.md` §10 is the always-loaded summary; `/AGENTS.md` is the front door. Moved verbatim on 2026-11-01 (move map: `docs/governance/decisions/2026-11-01-rulebook-restructure-map.md`).

# Deploying VenueOS — health, deploy proof, CI gates, rollback

## Deploy reliability (Railway + Vercel)

Every Railway redeploy must come up without hand-holding. Below is how to verify and recover.

**Health endpoints** (all under `/api/v1`):
- `GET /health` — liveness. Always 200 (even if DB/Redis degraded — the truth is in the body). Returns `{ status, db, redis, uptime, version, commit, timestamp }`. Monitoring uses it (`keep-warm.yml`, `node scripts/venueos.cjs status`); Railway's deploy healthcheck does NOT.
- `GET /health/started` — the Railway deploy healthcheck (`healthcheckPath` in `railway.json`). A one-way latch: 503 until the DB has served a real query and Redis has settled (or a ceiling of about 45 s passes), 200 forever after — it can never fail a running pod.
- `GET /health/ready` — readiness. 503 when DB unreachable. Use for monitoring, NOT Railway.
- `GET /health/emergency-path` — verifies DB + WS signer chain before a drill.

**Verify a deploy succeeded:**
1. `curl https://<railway-api>/api/v1/health` returns 200 with `db:"ok"` **and a `commit` equal to the merge commit's SHA.** `/health` is 200 even when degraded, and the previous container keeps answering until the new one takes over, so the `commit` field is the proof of a deploy (`node scripts/venueos.cjs status` shows local, origin, DEPLOYED and CI in one view). A `commit` of `dev` or the previous SHA means it is not deployed.
2. Railway dashboard: deployment shows "Healthy" (green) — it passed `/api/v1/health/started` (`healthcheckPath` in `railway.json`).
3. There is no Vercel cron: `.github/workflows/keep-warm.yml` (GitHub Actions, every 5 minutes; per its header it replaced the Vercel cron, which the Hobby plan limits to daily) pings `/health` (the body must contain `"db":"ok"`), `/health/ready` and `/health/emergency-path` and fails if any does not answer. `apps/web/vercel.json` schedules no cron.

**If the demo breaks:**
- API unreachable → Railway → Deployments → Restart latest. Auto-restart covers most blips (restart policy `ON_FAILURE`, up to 10 retries; the 300 s in `railway.json` is `healthcheckTimeout` — how long a new deploy gets to pass `/health/started` — not a restart window).
- UI says "Can't reach the server" → check `NEXT_PUBLIC_API_URL` in Vercel env. If unset the frontend falls back to localhost — set it and redeploy web.
- DB errors in Railway logs → Supabase pooler hiccup. Boot warm-up logs `Prisma pool warm (Nms)`; if consistently >2s, check `DATABASE_URL` / `DIRECT_URL` split.
- Redis missing → API boots anyway (HTTP-polling realtime fallback). Emergency trigger still works.

**Never do:** weaken the 10-retry restart policy, add DB checks to liveness, or remove the 7s Redis hard-cap in `redis.service.ts`. Those three keep Railway from pod-thrashing.

**Railway config-as-code is DEPRECATED (learned 2026-09-23).** New services cannot use a
`railway.json`, and existing files stop being read on **2026-12-01** (hard cutoff). The root
`railway.json` keeps ONLY its `deploy` section for the API; its `build` section was removed because
Railway applied it to every service building from the repo root (the new `renderer` service built
the API image three times). The API's dashboard settings mirror the file exactly, and a second
service points at its own Dockerfile through **Settings → Build → Dockerfile path** plus the
variable `RAILWAY_DOCKERFILE_PATH` — never a per-service `railway.json`, never a Root Directory
(`apps/renderer/README.md`, "Deploying on Railway"). Before 2026-12-01 the API must move to
Infrastructure as Code (`.railway/railway.ts`, `railway config migrate` — needs `railway login`);
as of 2026-11-01 no `.railway/` directory exists yet, and this is a dated Phase 1 item
(`docs/governance/MECHANISMS.md`).

**Multi-replica (2026-09-03).** Every cluster-singleton background worker now takes a Redis leader lease before its tick (`LEASE` in `apps/api/src/realtime/leader-lease.service.ts`; 25 leased, 12 deliberately not — each un-leased one carries a `NO LEADER LEASE, DELIBERATELY` comment at the site that gives the reason). Two rules: a replica that cannot reach Redis **assumes leadership and logs it** (degraded == today's single-replica behaviour, never worse), and a health/liveness probe is never leased — a replica that has lost Postgres cannot take a lease, so leasing its probe would silence the page exactly when it should fire. Express sessions are in Redis for the same reason; they fail SOFT (a store error must never 500 the dashboard).

## Backup & Rollback

Refer to `docs/BACKUP_AND_ROLLBACK.md` for full procedures: rolling back is a revert PR or a redeploy of the previous build (never `git reset --hard` or a force-push on `master`), and the database is backed up nightly by `.github/workflows/db-backup.yml` — no restore drill has run yet.
Before a risky change, tag and push that one tag; a tarball never contains `.env` files.

## Deploy Reliability — CI gates

The `.github/workflows/deploy-reliability.yml` pipeline runs on every push
to master + every PR (one that touches only `docs/**`, root `*.md`, `.claude/**`,
`scratch/**` or `LICENSE` skips it) with eight parallel jobs: `APK version is tagged`,
`pnpm lockfile drift`, `schema change ships a migration`, `API + workspace packages build`,
`Web Jest (unit)`, `Web typecheck + build`, `Docker build + boot smoke test` and
`Renderer image build + render smoke test`. They detect the build failures we hit in production debugging on 2026-04-19. Incident: `docs/incidents/2026-04-19-alpine-native-build-failures.md`.

**What blocks a merge, and what does not (2026-11-01).** The ruleset "Master deploy safety"
requires only FOUR checks — `pnpm lockfile drift`, `API + workspace packages build`,
`Web typecheck + build` and `Docker build + boot smoke test` — and an admin can bypass it
("always"). Every other gate (the other four jobs above, the emergency-path e2e, tenant
isolation, cross-browser, mobile-perf, taurus-safety, a11y, the API Jest suite)
runs and reports but does NOT block. Nothing requires a pull request, and **Railway and
Vercel deploy on push, not on CI success** — a merge to master is a deploy. The change that
would make the risk-weighted gates required is recorded, not applied:
`docs/governance/decisions/2026-10-31-required-checks-ruleset.md`. **Never merge on red:
wait for the PR's checks to finish green before the Lead merges.**

### Build failure modes we've seen, and how the CI catches them

1. **argon2 fails to native-compile on Alpine** (`bcrypt`, which did too, is no
   longer a dependency).
   The Dockerfile builder stage is `node:22.23.4-alpine` (pinned by digest in
   `ARG NODE_IMAGE`), which ships without a
   C/C++ toolchain. Without `apk add python3 make g++ openssl libc6-compat`
   before `pnpm install`, the package fails its `node-gyp` build with
   a cryptic `ELIFECYCLE` and Railway shows "Application failed to
   respond." → Caught by the **`docker-build`** job which runs the same
   image Railway will run.

2. **Prisma schema not present at install time.**
   The root `postinstall` runs `pnpm db:generate` which calls
   `prisma generate`, which needs `packages/database/prisma/schema.prisma`
   on disk. Dockerfile must `COPY packages/database/prisma` BEFORE
   `pnpm install`. → Caught by **`docker-build`**.

3. **Workspace TS packages need a build step.**
   `packages/{api-types,scoreboard-cts,signage-design}` have `package.json`
   `main` pointing at `dist/index.js`. The Dockerfile must build them before the
   API or `node apps/api/dist/main.js` crashes with `SyntaxError:
   Unexpected token 'export'` when it tries to require a raw `.ts` file.
   (This used to name `auth-core` and `ws-events`; both are gone — see the
   monorepo layout note above. Do not re-add them to the Dockerfile.)
   → Caught by **`api-build`** and **`docker-build`**.

4. **Lockfile drift.** Adding a devDep to a package.json without re-running
   `pnpm install` breaks `pnpm install --frozen-lockfile` on Railway with
   `ERR_PNPM_OUTDATED_LOCKFILE`. → Caught by **`lockfile-check`**, AND
   pre-emptively blocked locally by `.husky/pre-commit`.

5. **TypeScript errors in `apps/web`.** Next.js fails the production
   build on type errors (`morning-news.tsx` hit this with a stale
   `'dayperiod'` type). → Caught by **`web-build`**.

### Local preflight

Before pushing, run `pnpm preflight` from the repo root. It runs the same
non-Docker checks the CI does (lockfile + workspace builds + API + web)
in under 90 seconds. The Docker check is slower locally but not CI-only:
`node scripts/venueos.cjs env up` builds the real API image and boots it against an
isolated Postgres, and `node scripts/venueos.cjs verify` runs every CI-wired gate locally.

### Post-push: WATCH CI TO GREEN — do not declare "done" before it resolves (2026-05-31)

`pnpm preflight` is NOT proof CI will pass. It skips Docker AND it runs on
*your* machine, where native modules (argon2; `bcrypt` is no longer a dependency) are already built and
cached. The raw GitHub runner is a fresh `pnpm install --frozen-lockfile`
that does **not** rebuild those bindings for the Jest job — so a suite that's
green locally can have 5 suites *fail to load* in CI (`Cannot find module
.../argon2.node`). Incident: `docs/incidents/2026-05-31-jest-gate-green-locally-red-in-ci.md`.

**Standing rule:** after EVERY `git push` of a branch, watch the PR's checks to completion and
react to red BEFORE telling the user anything shipped. The agent has `gh` — there is no excuse
to make the user your CI monitor. Backgroundable, so the harness re-invokes you on completion
(it exits non-zero if any check failed):

```bash
gh pr checks <PR-number> --watch      # add --required to see only the checks that can block the merge
```

After the Lead merges, the merge commit's SHA is NOT your local HEAD (a merge or squash makes a
new commit), so key the follow-up on it — the push run on master, then the deploy:

```bash
sha=<merge commit SHA>
gh run list --commit "$sha" --json workflowName,status,conclusion -q '.[]|"\(.status) \(.conclusion) \(.workflowName)"'
curl -s https://<railway-api>/api/v1/health   # "commit" must equal $sha  (or: node scripts/venueos.cjs status)
```

"Pushed, CI watch running" is honest. "Done / shipped" before CI is green is
the exact over-claim the operator has banned repeatedly.

### Pre-commit hook (husky)

`.husky/pre-commit` blocks any commit that would drift `pnpm-lock.yaml`, and any staged
player/widget file containing `inset: 0` (For AI Assistants #10). `.husky/pre-push` runs
`pnpm preflight` (the api + web builds) and prints non-blocking workspace-hygiene warnings;
neither hook scans for secrets — gitleaks runs in CI (`ci.yml`).
Activates automatically after `pnpm install` (via the `prepare` script).
On Windows, Git for Windows runs the hook through its bundled `sh.exe`;
no extra config needed.

### When the demo breaks despite all this

Check **Railway dashboard → Deployments → latest → Build Logs**, then
**Deploy Logs**. Build Logs show Dockerfile failures; Deploy Logs show
runtime crashes. The /api/v1/health endpoint always returns 200 even
when DB or Redis are degraded — so if you get 502 "Application failed to
respond," the container itself is down (not a downstream service).

### What never to do

- Change `healthcheckPath` in `railway.json` (today `/api/v1/health/started`) without
  first confirming the container actually boots and that endpoint responds. The
  healthcheck GATES the deploy — a never-responding endpoint blocks all new code.
- Bump the `argon2` major version without testing on Alpine
  Docker locally first (`node scripts/venueos.cjs env up`). It has changed its
  build requirements multiple times.
- Add a workspace package without a `tsconfig.json` and `dist/index.js`
  in its `main`. The API's CommonJS `require()` cannot parse raw
  TypeScript at runtime.

## Repository visibility (item 5 of the old "For AI Assistants" list)

5. **Repo is PUBLIC again on GitHub** (`https://github.com/gschiemann/EDUCMS`) as of 2026-09-14 — public 2026-04→08-01, private 08-01→09-14. It went back for cost: the private Free plan's Actions spending limit was refusing every job (nightly backups included) while Railway still deployed each push, and its 2-vCPU runners OOM-killed the e2e gate. Public = unlimited standard-runner minutes, the 4-vCPU class back, branch protection / rulesets back, GitHub secret scanning + push protection on. **Public is NOT open source** — `LICENSE` is a source-available, all-rights-reserved notice. **Every commit, PR and issue is world-readable, so: no hardcoded credentials, API keys, customer names or PII, ever**; the CI gitleaks gate + `.gitleaksignore` (per-fingerprint, never per-path) are the mechanical floor. A full-history `gitleaks` scan on 2026-09-14 (3,442 commits) found only doc examples, React `key=` props, the SEC-006 canary and two pre-August hex values whose secrets were rotated on 2026-09-04.

   If it ever goes private again, remember what that removes (learned 2026-08→09): **no branch protection and no rulesets** on Free + private (`403 Upgrade to GitHub Pro`), so nothing would gate a merge at all (even while public, the ruleset requires only four build checks and an admin can bypass it, and Railway and Vercel deploy on push, not on CI success — see Deploy Reliability); **runners halve** to 2 vCPU / 7 GB (heavy suites need `--maxWorkers=2` + `NODE_OPTIONS=--max-old-space-size=4096`); and a **spending limit** that refuses every job with 0 steps — including the nightly DB backup — while pushes still deploy. Either way: watch CI to green after every push, and never call something shipped before it resolves.
