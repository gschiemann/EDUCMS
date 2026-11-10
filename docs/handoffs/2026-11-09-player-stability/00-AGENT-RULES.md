# Rules for every build agent on the 2026-11-09 player stability work

You are building one work package for VenueOS (signage + life-safety alerts). The Android player (`apps/player`) and the web player (`apps/web/src/app/player`) are the core product and run unattended on customer screens. The owner asked: "make sure our player is the best in the business and we have all the functions to ensure it's stable all the time", then "Build it all".

## First
1. You are in your own git worktree. Run `git fetch origin && git checkout -B <your branch> origin/master` before anything else.
2. Read `AGENTS.md`, `CLAUDE.md`, and the nested `CLAUDE.md` of every area you touch (`apps/player/CLAUDE.md`, `apps/web/src/app/player/CLAUDE.md`, `apps/api/src/emergency/CLAUDE.md`, `packages/database/CLAUDE.md`, `apps/web/CLAUDE.md`).
3. Read the gap list: `/Users/gschiemann/Desktop/EDU CMS/docs/handoffs/2026-11-09-player-stability-inventory.md`. It was produced by a quick code search and has already been wrong twice. **Verify your gap in the code before building.** If the function already exists, do not build a second one: report what exists, and build only the part that is really missing.

## Hard rules
- Never push, never open a PR, never merge. Commit on your branch in your worktree and return the branch name. The lead reviews and pushes.
- Edit only files inside your worktree. Never touch the main checkout or another worktree.
- No device owner, ever. Nothing may require device-owner or root rights.
- Never weaken the emergency path. An active emergency alert or emergency hold must never be interrupted, hidden, delayed or released by your feature; the native alert watch keeps running. When in doubt the alert shows.
- Never interrupt playback during operating hours. Engine behaviour auto-detects per device; add no operator setting for it. A flag is a subtractive kill switch (unset = behaviour as shipped by your change being OFF is NOT required, but every autonomous behaviour needs a kill switch and a written failure direction). Every environment variable is declared in `apps/api/src/config/env-schema.ts` and the generated docs are refreshed (`node apps/api/tools/generate-env-docs.cjs`).
- Never fight the Goodview CMS: write a device value only on a real change, read before write, no re-assert loops.
- Tenant isolation: every Prisma query on a tenant-owned model constrains `tenantId`. Every privileged action writes an `AuditLog` row.
- A schema change ships an additive, idempotent migration file in the same commit. Never run `db:push` against anything but a local database. No destructive database operation.
- K-12 student names and photos are default-deny for anything that copies screen content off the device.
- Every user-facing string ships in en, es and zh (`check-i18n-parity.cjs`). UI reuses the app's existing components and style. Before editing a UI component, prove it is mounted from a route.
- Player/widget web code also runs on Chromium 83: no CSS `inset` shorthand, no flex `gap`, no `AbortSignal.timeout`.
- The repository is public: no customer names, no secrets, no production credentials. Do not read `.env` files.
- Never run `pnpm --filter api run lint` (it rewrites files). Never use `--no-verify`. Never use bare `git stash`.
- Two pull requests are open and unmerged: #294 (Kotlin: `MainActivity.kt`, `WebAppBridge.kt`, `DisplayControlApi.kt`, `FacePlayerHost.kt`, `BridgeNonce.kt`, `NativeBridgeChannel.kt`) and #295 (web: `apps/web/src/app/player/page.tsx` push-gate lines, `storageEstimate.ts`, new `staleDropRecovery.ts`). Keep your diff small in those files and list any overlap in your report.
- Put decisions in pure, unit-tested policy functions; keep Android glue thin. Don't over-engineer: the smallest design that does the job.

## Setup recipes
- JS: `pnpm install --frozen-lockfile`, then `unlink node_modules/node_modules` if that stray symlink exists, then build `@cms/api-types`, `@cms/scoreboard-cts`, `@cms/signage-design` before jest or tsc.
- Kotlin: `export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home; export PATH="$JAVA_HOME/bin:$PATH"`, then `"/Users/gschiemann/Desktop/EDU CMS/apps/player/gradlew" -p apps/player :app:testDebugUnitTest` (and `:app:lintDebug`, `:manager:testDebugUnitTest` if you touch the manager).
- API: run the specs you touch plus the whole API jest suite if you touch auth, guards or shared services. Web: `npx jest <paths>` and `npx tsc --noEmit -p .` in `apps/web`.
- `node scripts/check-rulebook.cjs` must PASS; state your new behaviour in the right nested `CLAUDE.md` and add a `## 2026-11-09` paragraph to `CHANGELOG.md` (append to that heading if it exists).

## Done
- All work committed on your branch (message ends with `Co-Authored-By: Claude <noreply@anthropic.com>`), working tree clean.
- A report committed at `docs/handoffs/2026-11-09-player-stability/<NN>-<topic>.md`: what already existed, what you built, files changed, tests run with real counts, what is NOT proven on hardware, kill switch and failure direction, overlap with #294/#295, open decisions for the owner.
- Your final message: branch name, commit SHA, and the report in under 300 words. Say plainly anything that failed or that you did not finish.
