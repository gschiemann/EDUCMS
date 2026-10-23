# Change management

**Owner:** VenueOS owner · **Last reviewed:** 2026-10-23 · **Covers:** the API, the web dashboard and player, the database schema, the Android player apps and how they are released

## How a change reaches production

1. **Author.** The owner or an AI coding agent writes the change on a branch. Agents work in isolated git worktrees, never push to master, and never touch the owner's main working tree.
2. **Review.** The lead engineer (the owner, or the primary assistant working for them) reads every agent diff before it is merged, runs the type checks and the affected tests, and for visible changes checks the rendered result. A change to emergency endpoints, payload validation, auth bypass or audit logging gets explicit review and an end-to-end test of trigger and clear.
3. **Local gates.** A pre-commit hook blocks a lockfile that has drifted from `package.json` and one known CSS regression class. A pre-push preflight (about 90 seconds) runs the lockfile check, the workspace builds and the API and web type checks. `--no-verify` skips it and is allowed only after running the preflight by hand.
4. **CI.** On every push and pull request that changes more than documentation: build, lint and unit tests for API and web; the accessibility lint ratchet; end-to-end tests in Chromium and WebKit; the emergency-alert path tests; the tenant-isolation gate; a check that a schema change ships a migration; a container build with a boot smoke test; the security scans in [vulnerability-management.md](vulnerability-management.md); and guards for committed signing keys and for player update wiring.
5. **Merge.** Changes arrive as pull requests (mostly larger or agent-authored work) or as direct commits by the maintainer after the preflight. A repository ruleset on master blocks deletion and force-push and requires four status checks, with the branch up to date, before a pull request can merge: lockfile drift, API and workspace package build, web type check and build, and container build with boot smoke test.
6. **Deploy.** A push to master deploys the API on Railway and the web app on Vercel. A new API container takes traffic only after it passes a startup health check, and Railway keeps the previous deployment live until then. A process that crashes is restarted up to 10 times.
7. **Verify.** After every push the owner watches CI to the end and checks that the live health endpoint reports the new commit. A change is not called shipped before both. Smoke tests then sign in to production and click through the dashboard in Chromium and WebKit.

## What is and is not enforced by tooling

- **Enforced:** the ruleset above, the CI gates, the health-gated cutover, and the pre-commit hook.
- **Not enforced:** a second human reviewer. The repository has one maintainer, the ruleset has no required-review rule, and the repository admin can bypass the ruleset, which the owner does when committing directly to master. Deploys do not wait for CI to finish, which is why step 7 and the rollback options below matter. There is no separate staging environment; Vercel builds a preview for pull requests.
- Documentation-only changes skip the build workflows by path filter. A path filter removes cost, not coverage, because any change to code still runs everything.

## Database changes

- Additive only: new tables and columns, never a destructive change to live data.
- A change to `schema.prisma` that alters the database ships a migration file in the same commit. CI fails if it does not. Production applies migration files and nothing else: the boot script runs `prisma migrate deploy` before the API starts. It retries a transient database blip with backoff, and a migration that still fails stops the boot instead of serving on a half-applied schema.
- Migrations are written to be safe to run twice. An applied migration is never edited, because Prisma compares checksums.
- A destructive command such as a full reset is refused unless the target is provably a local throwaway database.

## Releasing the Android player

| Ring | Who receives it | Gate |
|---|---|---|
| 0. Build | Nobody; it is an artifact | CI runs the Kotlin unit tests and lint (new findings block) and signs with the release key. A release tag also needs the hardware qualification matrix: every required hardware class must have a dated PASS for cold install, pairing, reboot recovery, offline recovery, content update, emergency drill, remote-only navigation, update push and boot proof. A logged override exists for hotfixes |
| 1. Field candidate (`x.y.z-field.N`) | Named test screens of named organizations, for a window of at most 24 hours that the operator arms. Test units, one at a time | A signed CI artifact whose SHA-256, size and CI run are recorded in a committed registry. It is held in a private mirror, never appears in the stable release list, is downloaded through a short-lived ticket, and is checked against its digest before it installs |
| 2. Canary | A percentage of one organization's screens, chosen by a stable hash of the screen ID | After a soak (24 hours by default) it is promoted only on positive evidence: a non-empty cohort, at least one confirmed install, and an error rate under the threshold. Any authenticated error halts it. The default is 100%, which means no canary |
| 3. Stable fleet | Every screen | A `player-vX.Y.Z` git tag creates a GitHub Release. The server verifies each build's digest (against a committed pin where one exists), keeps an anti-rollback floor so old vulnerable builds are never offered, and can stop offering any single build at once |

Owner rule since 2026-10-12: no mass forced update during playback. A new build goes to one screen per hardware class first, outside operating hours.

## Rollback

- **API and web:** revert the commit on master, or redeploy a previous deployment from the hosting dashboard. Because migrations are additive, the previous code runs against the newer schema. On 2026-09-16 a schema change shipped without a migration and the fleet errored until the code was reverted; the migration check in CI followed.
- **Data:** there is no undo for data. Fix forward, or restore from backup ([backup-and-recovery.md](backup-and-recovery.md)).
- **Player:** stop offering the build (quarantine it), then ship a higher version. The anti-rollback floor keeps old vulnerable builds from being offered again. Screens keep running the version they have.
- **Before a risky change:** tag the commit (`backup/pre-sprint-N-...`) and push the tag.
- Risky behavior ships behind switches. A kill switch can only remove behavior, so a stale value can never pin the fleet to an old or vulnerable build.

## Hotfixes and configuration

A hotfix uses the same pipeline. The only shortcuts are skipping the preflight after running it by hand and, for a player release, a logged hardware-qualification override. Configuration and secrets are changed in the hosting consoles and follow [`docs/SECRET-ROTATION.md`](../SECRET-ROTATION.md). The API's deploy settings are mirrored in `railway.json`.

## Records

Commit history, pull requests, CI runs and deploy logs are the record of every change. Release decisions for the player are recorded in the hardware qualification matrix.

## Gaps

- **Not in place:** required review by a second person. This changes when a second engineer joins.
- **Not in place:** deploys that wait for required checks.
- **Not in place:** a staging environment.
- **Planned:** moving the API's deploy settings to the provider's infrastructure-as-code format, because the provider stops reading `railway.json` on 2026-12-01.
