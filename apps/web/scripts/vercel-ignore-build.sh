#!/bin/sh
# Vercel "Ignored Build Step" for the web project (apps/web is the root
# directory; `vercel.json` points here). Exit 0 = SKIP the build, exit 1 =
# BUILD. Vercel treats ANY other exit code as a FAILED deployment (learned
# 2026-09-03: a `git diff` that hit a missing object exited 128 and failed
# five deployments in a row), so every path below ends in exactly 0 or 1.
#
# Skip only when a comparison base is known AND nothing the web build
# consumes changed since it. An unknown or unfetchable base means BUILD: a
# multi-commit push must never be judged by HEAD^ alone.
#
# 2026-11-15 (cost audit, docs/COST.md) - THE FIRST PUSH OF A BRANCH.
# `VERCEL_GIT_PREVIOUS_SHA` is empty on a branch's first deployment, and this
# script used to answer "empty = BUILD". Every new branch therefore paid for
# one full web build even when it touched only the API, the APK or docs -
# and Build CPU Minutes were the largest usage line on the 2026-11-14 invoice.
# A PREVIEW with no previous deployment is now compared with the tip of the
# production branch instead: a tree whose web inputs are identical to what
# production already built has nothing new to preview. Production itself, and
# every case where that tip cannot be fetched, still BUILDS.
#
# 2026-11-15, later the same day - `git fetch origin` DOES NOT WORK THERE. The
# rule above shipped comparing with `git fetch origin master`, and the first
# docs-only branch pushed after it (PR #323) built anyway: this script
# answered BUILD in 261 ms and, being silent, did not say why. Vercel's
# checkout is a depth-10 shallow clone with NO remote at all (this script's
# own line in the correcting branch's build log: `remotes: []`), so a fetch
# from `origin` can never succeed there and the script fell to its safe
# answer. The validation run before the merge used a branch that changed the
# web, where BUILD was the right answer for the wrong reason. The base is now
# fetched from the repository's own URL (`origin` stays as a second try for a
# checkout that has one), and every decision prints one line, so a build log
# says why it built. `vercel-ignore-build.test.sh` replays that checkout
# (shallow, no remote) and runs in CI.
#
# A PRIVATE repository would refuse the anonymous fetch. The answer is then
# BUILD on every first push, and the log line says so. That is a cost
# regression, never a wrong skip; it needs a read-only credential in Vercel's
# environment before the repository goes private (docs/COST.md).
#
# Nothing printed here may contain a URL or a remote's address.
say() { echo "[ignore-build] $*"; }

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || { say "BUILD: not inside a git checkout"; exit 1; }

repo_url="https://github.com/${VERCEL_GIT_REPO_OWNER:-gschiemann}/${VERCEL_GIT_REPO_SLUG:-EDUCMS}.git"

# fetch_ref <branch-or-sha>: leaves the commit in FETCH_HEAD. 0 = fetched.
fetch_ref() {
  if git fetch --depth=1 "$repo_url" "$1" >/dev/null 2>&1; then return 0; fi
  say "fetch from the repository URL failed for $1; trying a remote named origin"
  git fetch --depth=1 origin "$1" >/dev/null 2>&1
}

b="$VERCEL_GIT_PREVIOUS_SHA"
if [ -z "$b" ]; then
  if [ "$VERCEL_ENV" != "preview" ]; then
    say "BUILD: no previous deployment and not a preview (env=${VERCEL_ENV:-unset})"
    exit 1
  fi
  if [ "$VERCEL_GIT_COMMIT_REF" = "master" ]; then
    say "BUILD: no previous deployment of the production branch"
    exit 1
  fi
  # Names only: a remote's address may carry a credential.
  say "first deployment of this branch; checkout has $(git rev-list --count HEAD 2>/dev/null || echo an unknown number of) commits, remotes: [$(git remote 2>/dev/null | tr '\n' ' ')]"
  if ! fetch_ref master; then
    say "BUILD: first deployment of this branch and the production tip could not be fetched"
    exit 1
  fi
  b="$(git rev-parse --verify --quiet 'FETCH_HEAD^{commit}' 2>/dev/null)"
  if [ -z "$b" ]; then
    say "BUILD: the production tip was fetched but did not resolve to a commit"
    exit 1
  fi
  say "comparing with the production tip $b"
elif ! git cat-file -e "$b^{commit}" 2>/dev/null; then
  if ! fetch_ref "$b"; then
    say "BUILD: the previous deployment $b is not in this checkout and could not be fetched"
    exit 1
  fi
fi
if git diff --quiet "$b" HEAD -- apps/web packages pnpm-lock.yaml package.json turbo.json 2>/dev/null; then
  say "SKIP: nothing the web build consumes changed since $b"
  exit 0
fi
say "BUILD: the web build's inputs changed since $b, or the comparison failed"
exit 1
